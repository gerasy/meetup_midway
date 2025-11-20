import { formatMinutes, sec2hm } from './parsing.js';
import { fmtStopLabel, describeAction } from './formatters.js';
import { showRoutesOnMap, resetMap } from './map.js';
import { MAX_TRIP_TIME_S } from './constants.js';

const PREVIEW_DELAY_MS = 20000;

function scheduleMapUpdate(callback) {
    if (typeof callback !== 'function') {
        return;
    }

    if (typeof window === 'undefined') {
        callback();
        return;
    }

    const run = () => {
        try {
            callback();
        } catch (error) {
            console.error('Failed to update map rendering.', error);
        }
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(run));
    } else {
        setTimeout(run, 0);
    }
}

const iterationAnimationState = {
    active: false,
    baseMessage: ''
};

const previewState = {
    timer: null,
    latest: null,
};

export function beginIterationAnimation() {
    if (typeof document === 'undefined') {
        iterationAnimationState.active = false;
        iterationAnimationState.baseMessage = '';
        return;
    }

    const statusDiv = document.getElementById('status');
    if (!statusDiv) {
        iterationAnimationState.active = false;
        iterationAnimationState.baseMessage = '';
        return;
    }

    iterationAnimationState.active = true;
    const currentMessage = statusDiv.textContent || '';
    const baseMessage = currentMessage || 'Searching for meeting point...';
    iterationAnimationState.baseMessage = baseMessage;
    statusDiv.dataset.iterationBase = baseMessage;
    statusDiv.textContent = baseMessage;
}

export function updateIterationAnimation(iterations) {
    if (!iterationAnimationState.active || typeof document === 'undefined') {
        return;
    }

    const statusDiv = document.getElementById('status');
    if (!statusDiv) {
        return;
    }

    const base = statusDiv.dataset.iterationBase ?? iterationAnimationState.baseMessage ?? '';
    const label = base || 'Searching';
    statusDiv.textContent = `${label} (iterations: ${Number(iterations).toLocaleString()})`;
}

export function endIterationAnimation() {
    if (!iterationAnimationState.active) {
        return;
    }

    iterationAnimationState.active = false;

    if (typeof document === 'undefined') {
        iterationAnimationState.baseMessage = '';
        return;
    }

    const statusDiv = document.getElementById('status');
    if (!statusDiv) {
        iterationAnimationState.baseMessage = '';
        return;
    }

    const base = statusDiv.dataset.iterationBase ?? iterationAnimationState.baseMessage ?? '';
    statusDiv.textContent = base;
    delete statusDiv.dataset.iterationBase;
    iterationAnimationState.baseMessage = '';
}

function getPreviewContainer() {
    if (typeof document === 'undefined') {
        return null;
    }
    return document.getElementById('preview');
}

function clearPreview(message = 'Press "Find Meeting Point" to see a preview here after ~20 seconds.') {
    const container = getPreviewContainer();
    if (!container) {
        return;
    }
    container.innerHTML = message ? `<p>${message}</p>` : '';
}

function renderPreview() {
    const container = getPreviewContainer();
    if (!container) {
        return;
    }

    previewState.timer = null;

    if (!previewState.latest) {
        container.innerHTML = '<p>Still searching... a preview will appear once a result is available.</p>';
        return;
    }

    const { meetingLabel, meetingTime, startTime, fairnessLabel, peopleCount } = previewState.latest;

    container.innerHTML = `
        <h4>Preview</h4>
        <p><strong>Location:</strong> ${meetingLabel}</p>
        <p><strong>Meeting Time:</strong> ${meetingTime}</p>
        <p><strong>Start Time:</strong> ${startTime}</p>
        <p><strong>Participants:</strong> ${peopleCount}</p>
        <p><strong>Fairness:</strong> ${fairnessLabel}</p>
        <p><em>Generated about 20 seconds after starting the search.</em></p>
    `;
}

export function startPreviewCountdown() {
    if (previewState.timer) {
        clearTimeout(previewState.timer);
        previewState.timer = null;
    }
    previewState.latest = null;
    clearPreview('Preparing preview... please wait about 20 seconds.');
    previewState.timer = setTimeout(renderPreview, PREVIEW_DELAY_MS);
}

export function clearPreviewState(message) {
    if (previewState.timer) {
        clearTimeout(previewState.timer);
        previewState.timer = null;
    }
    previewState.latest = null;
    clearPreview(message);
}

function setPreviewData(data) {
    previewState.latest = data;
}

export function reconstructPath(person, stopId) {
    const path = [];
    let cur = stopId;
    while (person.parent.has(cur)) {
        const { prevStop, info } = person.parent.get(cur);
        path.unshift(info);
        cur = prevStop;
    }
    return path;
}

export function displayResults(meeting, persons, startTimeStr, stats = {}) {
    if (typeof document === 'undefined') {
        return;
    }

    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) {
        return;
    }

    if (!meeting) {
        clearPreviewState('No preview available. Adjust your inputs and try again.');
        const {
            totalVisitedNodes = 0,
            maxAccumulatedTime = 0,
            terminationReason = 'No meeting could be found.',
            queueSizes = [],
            terminationCode = null,
        } = stats;
        const queueSummary = queueSizes.length > 0
            ? queueSizes.map(({ label, size }) => `${label}: ${size}`).join(', ')
            : null;
        resultsDiv.innerHTML = `
            <div class="status-error">No meeting found before search exhausted.</div>
            <div class="status-meta">
                <p><strong>Visited nodes:</strong> ${totalVisitedNodes}</p>
                <p><strong>Max trip explored:</strong> ${formatMinutes(maxAccumulatedTime)}</p>
                <p><strong>Reason:</strong> ${terminationReason}</p>
                ${queueSummary ? `<p><strong>Queue sizes at stop:</strong> ${queueSummary}</p>` : ''}
            </div>
        `;
        const statusPrefix = terminationCode === 'ITERATION_LIMIT'
            ? 'Search paused at safety cap'
            : 'Search complete - no meeting found';
        const statusDetail = terminationReason ? `: ${terminationReason}` : '';
        setStatus(`${statusPrefix}${statusDetail}`, 'error');
        scheduleMapUpdate(() => resetMap());
        return;
    }

    if (meeting.type === 'CAP') {
        clearPreviewState('Preview unavailable because search was capped.');
        const {
            totalVisitedNodes = 0,
            maxAccumulatedTime = 0,
            terminationReason = `Person ${meeting.person.label} exceeded the 2-hour travel cap.`,
            queueSizes = [],
        } = stats;
        const queueSummary = queueSizes.length > 0
            ? queueSizes.map(({ label, size }) => `${label}: ${size}`).join(', ')
            : null;
        resultsDiv.innerHTML = `
            <div class="status-error">Search stopped: Person ${meeting.person.label} exceeded 2-hour travel time cap.</div>
            <div class="status-meta">
                <p><strong>Visited nodes:</strong> ${totalVisitedNodes}</p>
                <p><strong>Max trip explored:</strong> ${formatMinutes(maxAccumulatedTime)}</p>
                <p><strong>Reason:</strong> ${terminationReason}</p>
                ${queueSummary ? `<p><strong>Queue sizes at stop:</strong> ${queueSummary}</p>` : ''}
            </div>
        `;
        setStatus(`Search capped: ${terminationReason}`, 'error');
        scheduleMapUpdate(() => resetMap());
        return;
    }

    const stopId = meeting.stopId;
    const arrivals = persons.map(S => {
        const { arrTime, elapsed } = S.reachedStopFirst.get(stopId);
        return { label: S.label, elapsed, arrTime };
    });

    const meetTime = Math.max(...arrivals.map(a => a.arrTime));
    const maxElapsed = Math.max(...arrivals.map(a => a.elapsed));
    const minElapsed = Math.min(...arrivals.map(a => a.elapsed));

    const fairnessLabel = arrivals.map(a => `${a.label}: ${formatMinutes(a.elapsed)}`).join(', ');

    setPreviewData({
        meetingLabel: fmtStopLabel(stopId),
        meetingTime: sec2hm(meetTime),
        startTime: startTimeStr,
        fairnessLabel,
        peopleCount: persons.length,
    });

    if (!previewState.timer) {
        renderPreview();
    }

    let html = `
        <div class="result-header">
            <h3>Meeting Point Found!</h3>
            <p><strong>Location:</strong> ${fmtStopLabel(stopId)}</p>
            <p><strong>Start Time:</strong> ${startTimeStr}</p>
            <p><strong>Meeting Time:</strong> ${sec2hm(meetTime)}</p>
            <p><strong>Fairness:</strong> ${fairnessLabel} |
               Max: ${formatMinutes(maxElapsed)} | Diff: ${formatMinutes(maxElapsed - minElapsed)}</p>
        </div>
    `;

    const mapPaths = [];

    for (const S of persons) {
        const { arrTime, elapsed } = S.reachedStopFirst.get(stopId);
        const path = reconstructPath(S, stopId);

        mapPaths.push({
            label: S.label,
            startStopId: S.startStopId,
            steps: path
        });

        let startLocation;
        if (S.isAddress) {
            startLocation = S.stationName;
        } else {
            startLocation = fmtStopLabel(S.startStopId);
        }

        html += `
            <div class="person-result">
                <h4>Person ${S.label}</h4>
                <p><strong>Start:</strong> ${sec2hm(S.t0)} at ${startLocation}</p>
                <p><strong>Arrival:</strong> ${sec2hm(arrTime)} (${Math.floor(elapsed / 60)} minutes travel time)</p>
                <div><strong>Route:</strong></div>
        `;

        for (const step of path) {
            html += `<div class="step">${describeAction(step)}</div>`;
        }

        html += `</div>`;
    }

    resultsDiv.innerHTML = html;
    setStatus('Meeting point found successfully!', 'success');
    scheduleMapUpdate(() => showRoutesOnMap(stopId, mapPaths));
}

export function setStatus(message, type) {
    if (typeof document === 'undefined') {
        return;
    }

    const statusDiv = document.getElementById('status');
    if (!statusDiv) {
        return;
    }

    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
}

export function updateProgress(tripTimeMinutes) {
    if (typeof document === 'undefined') {
        return;
    }

    const maxTime = MAX_TRIP_TIME_S / 60; // Convert to minutes for UI scaling
    const percentage = Math.min(100, (tripTimeMinutes / maxTime) * 100);

    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressTime = document.getElementById('progressTime');

    if (progressBar) {
        progressBar.style.width = percentage + '%';
    }
    if (progressPercent) {
        progressPercent.textContent = Math.round(percentage) + '%';
    }
    if (progressTime) {
        // Show time with one decimal place for smoother updates
        progressTime.textContent = tripTimeMinutes.toFixed(1) + ' min';
    }
}

export function showProgress() {
    if (typeof document === 'undefined') {
        return;
    }

    const progressLabel = document.getElementById('progressLabel');
    if (progressLabel) {
        progressLabel.textContent = 'Searching...';
    }
    updateProgress(0);
}

export function hideProgress() {
    if (typeof document === 'undefined') {
        return;
    }

    const progressLabel = document.getElementById('progressLabel');
    if (progressLabel) {
        progressLabel.textContent = 'Ready to search';
    }
    updateProgress(0);
}
