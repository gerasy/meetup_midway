import { gtfsData } from './state.js';
import { toSeconds, formatTime } from './parsing.js';
import { autoResolveAllAddresses } from './addressResolver.js';
import { showRoutesOnMap } from './map.js';
import { algorithmRegistry } from './algorithms/algorithmRegistry.js';
import { formatDuration, getStopName } from './core/routingUtils.js';

function setStatus(message, type) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) return;

    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
    statusDiv.style.display = message ? 'block' : 'none';
}

let displayedRouteIndices = new Set();
let currentRoutes = [];

function renderRoute(route, index, fastestTime, { onToggle, isSelected }) {
    const card = document.createElement('div');
    card.className = 'route-card';
    card.dataset.routeIndex = index;
    if (index === 0) card.classList.add('best');
    if (isSelected) card.classList.add('selected');

    const header = document.createElement('div');
    header.className = 'route-header';

    const title = document.createElement('div');
    const titleText = document.createElement('span');
    titleText.className = 'route-title';
    titleText.textContent = `Route ${index + 1}`;
    title.appendChild(titleText);

    const badge = document.createElement('span');
    badge.className = `route-badge ${index === 0 ? 'fastest' : 'alternative'}`;
    badge.textContent = index === 0 ? 'FASTEST' : `+${Math.round((route.totalTime - fastestTime) / 60)}min`;
    title.appendChild(badge);

    const time = document.createElement('div');
    time.className = 'route-time';
    time.textContent = formatDuration(route.totalTime);

    header.appendChild(title);
    header.appendChild(time);
    card.appendChild(header);

    const summary = document.createElement('div');
    summary.style.cssText = 'color: var(--subtle-text); margin-bottom: 10px; font-size: 13px;';
    summary.textContent = `Arrives at ${formatTime(route.arrivalTime)} • ${route.path.length} steps`;
    card.appendChild(summary);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'map-toggle';
    toggleBtn.textContent = isSelected ? 'Shown on map' : 'Show on map';
    toggleBtn.addEventListener('click', event => {
        event.stopPropagation();
        onToggle?.();
    });
    card.appendChild(toggleBtn);

    // Render path steps
    route.path.forEach(step => {
        const stepDiv = document.createElement('div');
        stepDiv.className = `step step-${step.mode.toLowerCase()}`;

        if (step.mode === 'WALK') {
            const dist = step.distance_m ? Math.round(step.distance_m) : '?';
            const duration = step.arrive_sec - step.depart_sec;
            const fromName = step.from_stop ? getStopName(step.from_stop) : step.from;
            const toName = step.to_stop ? getStopName(step.to_stop) : step.to;
            stepDiv.innerHTML = `🚶 Walk ${dist}m (${formatDuration(duration)})<br><span style="font-size: 12px; color: var(--subtle-text);">${fromName} → ${toName}</span>`;
        } else if (step.mode === 'TRANSIT') {
            const duration = step.alight_sec - step.board_sec;
            stepDiv.innerHTML = `🚇 ${step.route_short_name} to ${step.trip_headsign || 'destination'}<br><span style="font-size: 12px; color: var(--subtle-text);">${getStopName(step.from_stop)} (${formatTime(step.board_sec)}) → ${getStopName(step.to_stop)} (${formatTime(step.alight_sec)}) • ${formatDuration(duration)}</span>`;
        }

        card.appendChild(stepDiv);
    });

    card.addEventListener('click', event => {
        if (event.target.closest('.map-toggle')) return;
        onToggle?.();
    });

    return card;
}

function updateMapSelection() {
    if (currentRoutes.length === 0) {
        showRoutesOnMap(null, []);
        return;
    }

    const orderedIndices = Array.from(displayedRouteIndices).sort();
    const meetingStopId = orderedIndices
        .map(idx => currentRoutes[idx]?.destStopId)
        .find(Boolean);
    const pathData = orderedIndices
        .map(idx => {
            const route = currentRoutes[idx];
            if (!route?.startStopId) return null;
            return {
                label: `Route ${idx + 1}`,
                startStopId: route.startStopId,
                steps: route.path
            };
        })
        .filter(Boolean);

    showRoutesOnMap(meetingStopId, pathData);
}

function setCardSelection(index, selected) {
    const card = document.querySelector(`.route-card[data-route-index="${index}"]`);
    if (!card) return;

    card.classList.toggle('selected', selected);
    const toggleBtn = card.querySelector('.map-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = selected ? 'Shown on map' : 'Show on map';
    }
}

function toggleRouteOnMap(index) {
    if (index === 0) {
        // Always keep the fastest route visible
        return;
    }

    if (displayedRouteIndices.has(index)) {
        displayedRouteIndices.delete(index);
        setCardSelection(index, false);
    } else {
        displayedRouteIndices.add(index);
        setCardSelection(index, true);
    }

    updateMapSelection();
}

export async function findTopRoutes() {
    try {
        if (gtfsData.stops.length === 0) {
            setStatus('Please wait for GTFS data to load', 'error');
            return;
        }

        const resultsDiv = document.getElementById('results');
        if (resultsDiv) resultsDiv.innerHTML = '';

        const startTimeInput = document.getElementById('startTime');
        if (!startTimeInput) {
            setStatus('Start time input not found', 'error');
            return;
        }

        const startTimeStr = startTimeInput.value + ':00';
        const t0 = toSeconds(startTimeStr);

        // Auto-resolve addresses
        setStatus('Resolving addresses...', 'loading');
        try {
            await autoResolveAllAddresses();
        } catch (error) {
            console.error('Error during auto-resolution:', error);
        }

        // Collect inputs
        const pointAInput = document.getElementById('pointA');
        const pointBInput = document.getElementById('pointB');

        if (!pointAInput.value.trim() || !pointBInput.value.trim()) {
            setStatus('Please enter both starting point and destination', 'error');
            return;
        }

        const startPoint = {
            query: pointAInput.value.trim(),
            isAddress: !!(pointAInput.dataset.addressLat && pointAInput.dataset.addressLon),
            lat: pointAInput.dataset.addressLat ? parseFloat(pointAInput.dataset.addressLat) : null,
            lon: pointAInput.dataset.addressLon ? parseFloat(pointAInput.dataset.addressLon) : null
        };

        const endPoint = {
            query: pointBInput.value.trim(),
            isAddress: !!(pointBInput.dataset.addressLat && pointBInput.dataset.addressLon),
            lat: pointBInput.dataset.addressLat ? parseFloat(pointBInput.dataset.addressLat) : null,
            lon: pointBInput.dataset.addressLon ? parseFloat(pointBInput.dataset.addressLon) : null
        };

        // Get selected algorithm
        const algorithmSelect = document.getElementById('algorithmSelect');
        const algorithmName = algorithmSelect ? algorithmSelect.value : null;
        const algorithm = algorithmRegistry.getAlgorithm(algorithmName);

        setStatus(`Searching for routes using ${algorithm.getName()}...`, 'loading');

        const routes = await algorithm.searchRoutes({
            startPoint,
            endPoint,
            startTimeSec: t0
        });

        if (routes.length === 0) {
            setStatus('No routes found', 'error');
            return;
        }

        // Show stats if available
        const stats = algorithm.getStats();
        let statusMsg = `Found ${routes.length} route${routes.length > 1 ? 's' : ''}`;
        if (stats) {
            statusMsg += ` (${Math.round(stats.executionTimeMs)}ms, ${stats.iterations.toLocaleString()} iterations)`;
        }
        setStatus(statusMsg, 'success');

        // Display routes and update the map
        displayRoutes(routes);

    } catch (error) {
        console.error('Error finding routes:', error);
        setStatus(`Error: ${error.message}`, 'error');
    }
}

export function displayRoutes(routes) {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = '';

    if (routes.length === 0) {
        resultsDiv.innerHTML = '<p>No routes found</p>';
        displayedRouteIndices = new Set();
        currentRoutes = [];
        updateMapSelection();
        return;
    }

    const fastestTime = routes[0].totalTime;
    currentRoutes = routes;
    displayedRouteIndices = new Set([0]);

    routes.forEach((route, idx) => {
        const routeCard = renderRoute(route, idx, fastestTime, {
            onToggle: () => toggleRouteOnMap(idx),
            isSelected: displayedRouteIndices.has(idx)
        });
        resultsDiv.appendChild(routeCard);
    });

    updateMapSelection();
}
