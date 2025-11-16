import { MAX_TRIP_TIME_S, WALK_SPEED_MPS } from './constants.js';
import { gtfsData, parsedData } from './state.js';
import { processGTFSData, resolveStation, pickStartPlatform, nearbyStopsWithinRadius } from './gtfsProcessing.js';
import { MinHeap } from './queue.js';
import { toSeconds, formatTime } from './parsing.js';
import { haversineM } from './geometry.js';
import { findNearestStation, searchAddress } from './geocoding.js';
import { autoResolveAllAddresses } from './addressResolver.js';

const MIN_TRAVEL_TIME_S = 10;
const MAX_INITIAL_WALK_M = 1000;

function setStatus(message, type) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) return;

    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
    statusDiv.style.display = message ? 'block' : 'none';
}

// Dijkstra-style search from A to B
async function searchRoutesAtoB({ startPoint, endPoint, startTimeSec }) {
    processGTFSData();

    const routes = []; // Will store top 3 routes
    const visited = new Map(); // stopId -> best time to reach it
    const pq = new MinHeap();

    // Initialize start point
    let startStops = [];
    if (startPoint.isAddress) {
        // Find nearby transit stops
        parsedData.stopById.forEach((stop, stopId) => {
            const stopLat = parseFloat(stop.stop_lat);
            const stopLon = parseFloat(stop.stop_lon);
            if (!isNaN(stopLat) && !isNaN(stopLon)) {
                const distM = haversineM(startPoint.lat, startPoint.lon, stopLat, stopLon);
                if (distM <= MAX_INITIAL_WALK_M) {
                    const walkTime = Math.ceil(distM / WALK_SPEED_MPS);
                    startStops.push({ stopId, walkTime, distM });
                }
            }
        });
        if (startStops.length === 0) {
            throw new Error('No transit stops found within 1km of starting address');
        }
    } else {
        // It's a station
        const resolved = resolveStation(startPoint.query);
        const chosenStart = pickStartPlatform(resolved.stationId, startTimeSec);
        startStops = [{ stopId: chosenStart, walkTime: 0, distM: 0 }];
    }

    // Initialize destination
    let endStops = [];
    if (endPoint.isAddress) {
        // Find nearby transit stops
        parsedData.stopById.forEach((stop, stopId) => {
            const stopLat = parseFloat(stop.stop_lat);
            const stopLon = parseFloat(stop.stop_lon);
            if (!isNaN(stopLat) && !isNaN(stopLon)) {
                const distM = haversineM(endPoint.lat, endPoint.lon, stopLat, stopLon);
                if (distM <= MAX_INITIAL_WALK_M) {
                    const walkTime = Math.ceil(distM / WALK_SPEED_MPS);
                    endStops.push({ stopId, walkTime, distM });
                }
            }
        });
        if (endStops.length === 0) {
            throw new Error('No transit stops found within 1km of destination address');
        }
    } else {
        // It's a station
        const resolved = resolveStation(endPoint.query);
        const allPlatforms = [];
        parsedData.stopIdToStationId.forEach((stationId, stopId) => {
            if (stationId === resolved.stationId) {
                allPlatforms.push(stopId);
            }
        });
        endStops = allPlatforms.map(stopId => ({ stopId, walkTime: 0, distM: 0 }));
    }

    const endStopSet = new Set(endStops.map(s => s.stopId));

    // Add starting points to queue
    for (const start of startStops) {
        pq.push([start.walkTime, startTimeSec + start.walkTime, start.stopId], {
            stopId: start.stopId,
            arrivalTime: startTimeSec + start.walkTime,
            path: start.walkTime > 0 ? [{
                mode: 'WALK',
                from: 'START',
                to_stop: start.stopId,
                distance_m: start.distM,
                depart_sec: startTimeSec,
                arrive_sec: startTimeSec + start.walkTime
            }] : []
        });
    }

    let iterations = 0;
    const maxIterations = 5000000;

    while (pq.length > 0 && iterations++ < maxIterations && routes.length < 3) {
        const entry = pq.pop();
        const [accum, currentTime, currentStop] = entry.priority;
        const { path } = entry.data;

        // Skip if we've already found a better route to this stop
        if (visited.has(currentStop)) {
            const prevTime = visited.get(currentStop);
            if (currentTime >= prevTime) continue;
        }
        visited.set(currentStop, currentTime);

        // Check if we reached destination
        if (endStopSet.has(currentStop)) {
            const endStopInfo = endStops.find(s => s.stopId === currentStop);
            const finalTime = currentTime + endStopInfo.walkTime;
            const totalTime = finalTime - startTimeSec;

            const finalPath = [...path];
            if (endStopInfo.walkTime > 0) {
                finalPath.push({
                    mode: 'WALK',
                    from_stop: currentStop,
                    to: 'END',
                    distance_m: endStopInfo.distM,
                    depart_sec: currentTime,
                    arrive_sec: finalTime
                });
            }

            routes.push({
                totalTime,
                arrivalTime: finalTime,
                path: finalPath
            });

            if (routes.length >= 3) break;
            continue; // Keep searching for more routes
        }

        if (accum > MAX_TRIP_TIME_S) continue;

        // Expand: walks
        const walkEdges = parsedData.walkEdges.get(currentStop) || [];
        for (const edge of walkEdges) {
            const travelTime = Math.max(MIN_TRAVEL_TIME_S, edge.time);
            const newTime = currentTime + travelTime;

            pq.push([accum + travelTime, newTime, edge.to], {
                stopId: edge.to,
                arrivalTime: newTime,
                path: [...path, {
                    mode: 'WALK',
                    from_stop: currentStop,
                    to_stop: edge.to,
                    walk_sec: travelTime,
                    depart_sec: currentTime,
                    arrive_sec: newTime
                }]
            });
        }

        // Expand: geographic walks
        const nearbyStops = nearbyStopsWithinRadius(currentStop);
        for (const nbr of nearbyStops) {
            const distM = nbr.distance;
            const walkTime = Math.ceil(distM / WALK_SPEED_MPS);
            if (walkTime > MIN_TRAVEL_TIME_S) {
                const newTime = currentTime + walkTime;

                pq.push([accum + walkTime, newTime, nbr.stopId], {
                    stopId: nbr.stopId,
                    arrivalTime: newTime,
                    path: [...path, {
                        mode: 'WALK',
                        from_stop: currentStop,
                        to_stop: nbr.stopId,
                        walk_sec: walkTime,
                        distance_m: distM,
                        depart_sec: currentTime,
                        arrive_sec: newTime
                    }]
                });
            }
        }

        // Expand: transit rides
        const rows = parsedData.rowsAtStop.get(currentStop) || [];
        const validRows = rows.filter(r => r.dep_sec >= currentTime);

        for (const depRow of validRows) {
            const tripId = depRow.trip_id;
            const depTime = depRow.dep_sec;
            const wait = depTime - currentTime;

            const tripStops = parsedData.tripGroups.get(tripId) || [];
            const afterStops = tripStops.filter(s => s.stop_sequence > depRow.stop_sequence);

            for (const arrRow of afterStops) {
                if (arrRow.arr_sec === null) continue;
                const arrTime = arrRow.arr_sec;
                const ride = arrTime - depTime;
                const total = wait + ride;

                const tripInf = parsedData.tripInfo.get(tripId);

                pq.push([accum + total, arrTime, arrRow.stop_id], {
                    stopId: arrRow.stop_id,
                    arrivalTime: arrTime,
                    path: [...path, {
                        mode: 'TRANSIT',
                        route_short_name: tripInf?.route_short_name || tripInf?.route_id,
                        trip_headsign: tripInf?.trip_headsign || '',
                        from_stop: currentStop,
                        to_stop: arrRow.stop_id,
                        board_sec: depTime,
                        alight_sec: arrTime,
                        depart_sec: currentTime,
                        arrive_sec: arrTime
                    }]
                });
            }
        }
    }

    return routes;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}min`;
}

function getStopName(stopId) {
    const stop = parsedData.stopById.get(stopId);
    return stop ? stop.stop_name : stopId;
}

function renderRoute(route, index) {
    const card = document.createElement('div');
    card.className = 'route-card';
    if (index === 0) card.classList.add('best');

    const header = document.createElement('div');
    header.className = 'route-header';

    const title = document.createElement('div');
    const titleText = document.createElement('span');
    titleText.className = 'route-title';
    titleText.textContent = `Route ${index + 1}`;
    title.appendChild(titleText);

    const badge = document.createElement('span');
    badge.className = `route-badge ${index === 0 ? 'fastest' : 'alternative'}`;
    badge.textContent = index === 0 ? 'FASTEST' : `+${Math.round((route.totalTime - arguments[2]) / 60)}min`;
    title.appendChild(badge);

    const time = document.createElement('div');
    time.className = 'route-time';
    time.textContent = formatDuration(route.totalTime);

    header.appendChild(title);
    header.appendChild(time);
    card.appendChild(header);

    const summary = document.createElement('div');
    summary.style.cssText = 'color: var(--subtle-text); margin-bottom: 15px; font-size: 13px;';
    summary.textContent = `Arrives at ${formatTime(route.arrivalTime)} • ${route.path.length} steps`;
    card.appendChild(summary);

    // Render path steps
    route.path.forEach((step, stepIdx) => {
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

    return card;
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

        setStatus('Searching for routes...', 'loading');

        const routes = await searchRoutesAtoB({
            startPoint,
            endPoint,
            startTimeSec: t0
        });

        if (routes.length === 0) {
            setStatus('No routes found', 'error');
            return;
        }

        setStatus(`Found ${routes.length} route${routes.length > 1 ? 's' : ''}`, 'success');

        // Display routes
        const fastestTime = routes[0].totalTime;
        routes.forEach((route, idx) => {
            const routeCard = renderRoute(route, idx, fastestTime);
            resultsDiv.appendChild(routeCard);
        });

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
        return;
    }

    const fastestTime = routes[0].totalTime;
    routes.forEach((route, idx) => {
        const routeCard = renderRoute(route, idx, fastestTime);
        resultsDiv.appendChild(routeCard);
    });
}
