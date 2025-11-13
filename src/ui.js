import { formatMinutes, sec2hm } from './parsing.js';
import { fmtStopLabel, describeAction } from './formatters.js';
import { showRoutesOnMap, resetMap } from './map.js';

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

export function displayResults(meeting, persons, startTimeStr) {
    if (typeof document === 'undefined') {
        return;
    }

    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) {
        return;
    }

    if (!meeting) {
        resultsDiv.innerHTML = '<div class="status-error">No meeting found before search exhausted.</div>';
        setStatus('Search complete - no meeting found', 'error');
        resetMap();
        return;
    }

    if (meeting.type === 'CAP') {
        resultsDiv.innerHTML = `<div class="status-error">Search stopped: Person ${meeting.person.label} exceeded 2-hour travel time cap.</div>`;
        setStatus('Search capped', 'error');
        resetMap();
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

    let html = `
        <div class="result-header">
            <h3>Meeting Point Found!</h3>
            <p><strong>Location:</strong> ${fmtStopLabel(stopId)}</p>
            <p><strong>Start Time:</strong> ${startTimeStr}</p>
            <p><strong>Meeting Time:</strong> ${sec2hm(meetTime)}</p>
            <p><strong>Fairness:</strong> ${arrivals.map(a => `${a.label}: ${formatMinutes(a.elapsed)}`).join(', ')} |
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

        html += `
            <div class="person-result">
                <h4>Person ${S.label}</h4>
                <p><strong>Start:</strong> ${sec2hm(S.t0)} at ${fmtStopLabel(S.startStopId)}</p>
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
    showRoutesOnMap(stopId, mapPaths);
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
