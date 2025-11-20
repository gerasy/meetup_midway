import { MAX_TRIP_TIME_S, MAX_WALK_RADIUS_M, WALK_SPEED_MPS, MAX_WALK_TIME_S, MAX_PARTICIPANTS } from './constants.js';
import { gtfsData, parsedData } from './state.js';
import { processGTFSData, resolveStation, pickStartPlatform, nearbyStopsWithinRadius } from './gtfsProcessing.js';
import { MinHeap } from './queue.js';
import { toSeconds } from './parsing.js';
import { displayResults, setStatus, beginIterationAnimation, updateIterationAnimation, endIterationAnimation, showProgress, hideProgress, updateProgress, startPreviewCountdown, clearPreviewState } from './ui.js';
import { calculateGeographicMidpoint, haversineM } from './geometry.js';
import { findNearestStation } from './geocoding.js';
import { autoResolveAllAddresses } from './addressResolver.js';

const MIN_TRAVEL_TIME_S = 10;

// Helper to yield control back to the browser for UI updates
function yieldToUI() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function getStopCoordinates(stopId) {
    const stop = parsedData.stopById.get(stopId);
    if (!stop) return null;
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    if (isNaN(lat) || isNaN(lon)) return null;
    return { lat, lon };
}

function calculateDistanceToMidpoint(stopId, midpoint) {
    if (!midpoint) return 0;
    const coords = getStopCoordinates(stopId);
    if (!coords) return 0;
    return haversineM(coords.lat, coords.lon, midpoint.lat, midpoint.lon);
}

export function collectPersonInputs() {
    const inputs = Array.from(document.querySelectorAll('[data-person-input]'));
    return inputs.map((input, idx) => {
        const label = input.dataset.personLabel || String.fromCharCode(65 + idx);
        const query = (input.value || '').trim();

        // Check if this is an address (has coordinates stored)
        const addressLat = input.dataset.addressLat;
        const addressLon = input.dataset.addressLon;

        if (addressLat && addressLon) {
            return {
                label,
                query,
                isAddress: true,
                lat: parseFloat(addressLat),
                lon: parseFloat(addressLon)
            };
        }

        return {
            label,
            query,
            isAddress: false
        };
    });
}

export function validatePeopleInputs(people, { allowSinglePerson = false } = {}) {
    if (people.length === 0) {
        return { ok: false, error: 'Please add at least one participant.' };
    }

    if (people.length > MAX_PARTICIPANTS) {
        return { ok: false, error: `A maximum of ${MAX_PARTICIPANTS} participants is supported.` };
    }

    if (!allowSinglePerson && people.length < 2) {
        return { ok: false, error: 'Please enter at least two participants.' };
    }

    for (const person of people) {
        if (!person.query) {
            return { ok: false, error: `Please enter a station for Person ${person.label}.` };
        }
    }

    return { ok: true, people };
}

function enqueuePathwayTransferWalks(pq, curStop, curTime, accum, owner, midpoint) {
    const edges = parsedData.walkEdges.get(curStop) || [];
    for (const edge of edges) {
        const travelTime = Math.max(MIN_TRAVEL_TIME_S, edge.time);
        const distToMidpoint = calculateDistanceToMidpoint(edge.to, midpoint);
        pq.push(
            [accum + travelTime, curTime + travelTime, distToMidpoint, edge.to],
            {
                owner, mode: 'WALK', source: edge.source,
                from_stop: curStop, to_stop: edge.to,
                walk_sec: travelTime,
                depart_sec: curTime, arrive_sec: curTime + travelTime
            }
        );
    }
}

function enqueueGeoWalks(pq, curStop, curTime, accum, owner, midpoint) {
    const nearby = nearbyStopsWithinRadius(curStop, MAX_WALK_RADIUS_M);
    for (const { stopId: cand, distance: distM } of nearby) {
        if (parsedData.providedPairs.has(`${curStop}-${cand}`)) continue;
        let ttime = Math.ceil(distM / WALK_SPEED_MPS);
        ttime = Math.max(MIN_TRAVEL_TIME_S, ttime);
        if (ttime <= MAX_WALK_TIME_S) {
            const distToMidpoint = calculateDistanceToMidpoint(cand, midpoint);
            pq.push(
                [accum + ttime, curTime + ttime, distToMidpoint, cand],
                {
                    owner, mode: 'WALK', source: 'GEO',
                    from_stop: curStop, to_stop: cand,
                    walk_sec: ttime,
                    depart_sec: curTime, arrive_sec: curTime + ttime,
                    distance_m: Math.round(distM)
                }
            );
        }
    }
}

function enqueueRides(pq, curStop, curTime, accum, owner, midpoint) {
    const rows = parsedData.rowsAtStop.get(curStop) || [];
    const validRows = rows.filter(r => r.dep_sec >= curTime);

    for (const depRow of validRows) {
        const tripId = depRow.trip_id;
        const depTime = depRow.dep_sec;
        const wait = depTime - curTime;

        const tripStops = parsedData.tripGroups.get(tripId) || [];
        const afterStops = tripStops.filter(s => s.stop_sequence > depRow.stop_sequence);

        for (const arrRow of afterStops) {
            if (arrRow.arr_sec === null) continue;
            const arrTime = arrRow.arr_sec;
            const ride = arrTime - depTime;
            const total = wait + ride;

            const tripInf = parsedData.tripInfo.get(tripId);
            const distToMidpoint = calculateDistanceToMidpoint(arrRow.stop_id, midpoint);

            pq.push(
                [accum + total, arrTime, distToMidpoint, arrRow.stop_id],
                {
                    owner, mode: 'RIDE',
                    from_stop: curStop, to_stop: arrRow.stop_id,
                    trip_id: tripId,
                    route_id: tripInf?.route_id,
                    headsign: tripInf?.trip_headsign || '',
                    wait_sec: wait, ride_sec: ride,
                    depart_sec: depTime, arrive_sec: arrTime
                }
            );
        }
    }
}

function reconstructPathFromInfo(person, info) {
    const segments = [];
    let currentInfo = info;
    while (currentInfo) {
        segments.push({
            mode: currentInfo.mode,
            owner: currentInfo.owner,
            from_stop: currentInfo.from_stop,
            to_stop: currentInfo.to_stop,
            depart_sec: currentInfo.depart_sec,
            arrive_sec: currentInfo.arrive_sec,
            walk_sec: currentInfo.walk_sec,
            wait_sec: currentInfo.wait_sec,
            ride_sec: currentInfo.ride_sec,
            trip_id: currentInfo.trip_id,
            route_id: currentInfo.route_id,
            headsign: currentInfo.headsign,
            source: currentInfo.source,
        });

        if (currentInfo.mode === 'START') {
            break;
        }

        const parentEntry = person.parent.get(currentInfo.from_stop);
        if (!parentEntry) {
            currentInfo = {
                owner: person.label,
                mode: 'START',
                from_stop: null,
                to_stop: person.startStopId,
                depart_sec: person.t0,
                arrive_sec: person.t0,
            };
        } else {
            currentInfo = parentEntry.info;
        }
    }

    return segments.reverse();
}

function createPerson({ label, stationId, stationName, startStopId, t0, isAddress, addressLat, addressLon }) {
    if (!isAddress && !startStopId) {
        throw new Error(`No departing platforms found for ${stationName || stationId}.`);
    }

    return {
        label,
        stationId,
        stationName,
        startStopId,
        t0,
        isAddress: isAddress || false,
        addressLat,
        addressLon,
        pq: new MinHeap(),
        bestTimes: new Map(),
        reachedStopFirst: new Map(),
        parent: new Map()
    };
}

function primePerson(person, midpoint) {
    // If starting from an address, find all stations within 1km walking distance
    if (person.isAddress && person.addressLat && person.addressLon) {
        const MAX_INITIAL_WALK_M = 1000;
        let stationsFound = 0;

        // Iterate through all stops and find those within walking distance
        parsedData.stopById.forEach((stop, stopId) => {
            const stopLat = parseFloat(stop.stop_lat);
            const stopLon = parseFloat(stop.stop_lon);

            if (!isNaN(stopLat) && !isNaN(stopLon)) {
                const distM = haversineM(person.addressLat, person.addressLon, stopLat, stopLon);

                if (distM <= MAX_INITIAL_WALK_M) {
                    const walkTime = Math.ceil(distM / WALK_SPEED_MPS);
                    const arrivalTime = person.t0 + walkTime;
                    const distToMidpoint = calculateDistanceToMidpoint(stopId, midpoint);

                    // Add this stop as a starting point with initial walk time
                    person.pq.push(
                        [walkTime, arrivalTime, distToMidpoint, stopId],
                        {
                            owner: person.label,
                            mode: 'WALK',
                            source: 'ADDRESS',
                            from_stop: null,
                            to_stop: stopId,
                            walk_sec: walkTime,
                            depart_sec: person.t0,
                            arrive_sec: arrivalTime,
                            distance_m: Math.round(distM)
                        }
                    );
                    stationsFound++;
                }
            }
        });

        if (stationsFound === 0) {
            throw new Error(`No transit stations found within ${MAX_INITIAL_WALK_M}m of the address for ${person.label}.`);
        }

        return;
    }

    // Regular station start
    const distToMidpoint = calculateDistanceToMidpoint(person.startStopId, midpoint);
    person.pq.push(
        [0, person.t0, distToMidpoint, person.startStopId],
        { owner: person.label, mode: 'START', from_stop: null, to_stop: person.startStopId, depart_sec: person.t0, arrive_sec: person.t0 }
    );
    enqueuePathwayTransferWalks(person.pq, person.startStopId, person.t0, 0, person.label, midpoint);
    enqueueGeoWalks(person.pq, person.startStopId, person.t0, 0, person.label, midpoint);
    enqueueRides(person.pq, person.startStopId, person.t0, 0, person.label, midpoint);
}

export async function runMeetingSearch({ participants, startTimeSec }) {
    if (!Array.isArray(participants) || participants.length === 0) {
        throw new Error('No participants provided.');
    }

    if (gtfsData.stops.length === 0) {
        throw new Error('GTFS data has not been loaded.');
    }

    processGTFSData();

    const persons = participants.map(({ label, query, startStopId, isAddress, lat, lon }) => {
        // Handle address input - allow walking to any station within 1km
        if (isAddress && lat && lon) {
            return createPerson({
                label,
                stationId: null,
                stationName: query,
                startStopId: null,
                t0: startTimeSec,
                isAddress: true,
                addressLat: lat,
                addressLon: lon
            });
        }

        // Handle station name input
        const resolved = resolveStation(query);
        const stationId = resolved.stationId;
        const name = resolved.name;
        let chosenStart = startStopId;

        if (chosenStart) {
            const mappedStation = parsedData.stopIdToStationId.get(chosenStart);
            if (mappedStation && mappedStation !== stationId) {
                throw new Error(`Start platform ${chosenStart} does not belong to ${name}.`);
            }
        } else {
            chosenStart = pickStartPlatform(stationId, startTimeSec);
        }

        return createPerson({
            label,
            stationId,
            stationName: name,
            startStopId: chosenStart,
            t0: startTimeSec,
            isAddress: false
        });
    });

    // Calculate geographical midpoint of all participants' starting locations
    const startCoordinates = persons.map(p => {
        if (p.isAddress && p.addressLat && p.addressLon) {
            return { lat: p.addressLat, lon: p.addressLon };
        }
        return getStopCoordinates(p.startStopId);
    }).filter(c => c !== null);
    const midpoint = calculateGeographicMidpoint(startCoordinates);

    persons.forEach(person => primePerson(person, midpoint));

    let meeting = null;
    let iterations = 0;
    const maxIterations = 200000000;
    let globalMaxAccum = 0;
    let terminationReason = null;
    let terminationCode = null;
    let longestPathRecord = null;
    let capExceededDuringSearch = false;
    let lastCapExceededPerson = null;
    let lastProgressUpdateMinutes = 0;
    const PROGRESS_UPDATE_STEP_MIN = 0.5;

    beginIterationAnimation();
    updateIterationAnimation(iterations);

    try {
        while (iterations++ < maxIterations) {
            // Yield to browser every 1000 iterations for UI updates
            if (iterations % 1000 === 0) {
                updateIterationAnimation(iterations);
                await yieldToUI();
            }

            let minEntry = null;
            let minPerson = null;

            for (const S of persons) {
                if (S.pq.length > 0) {
                    const entry = S.pq.heap[0];
                    if (minEntry === null || entry.priority[0] < minEntry.priority[0]) {
                        minEntry = entry;
                        minPerson = S;
                    }
                }
            }

            if (!minEntry) {
                terminationReason = terminationReason || 'All participant queues are empty; no further nodes can be expanded.';
                terminationCode = terminationCode || 'EMPTY_QUEUE';
                updateIterationAnimation(iterations);
                break;
            }

            const accum = minEntry.priority[0];
            if (accum > globalMaxAccum) {
                globalMaxAccum = accum;
            }
            if (accum > MAX_TRIP_TIME_S) {
                capExceededDuringSearch = true;
                lastCapExceededPerson = minPerson;
                continue;
            }

            // Update progress bar based on the furthest elapsed travel time explored so far.
            const exploredMinutes = globalMaxAccum / 60;
            if (exploredMinutes - lastProgressUpdateMinutes >= PROGRESS_UPDATE_STEP_MIN) {
                updateProgress(exploredMinutes);
                lastProgressUpdateMinutes = exploredMinutes;
            }

            const popped = minPerson.pq.pop();
            const info = popped.data;
            const destStop = info.to_stop;

            if (!longestPathRecord || accum > longestPathRecord.accumulatedSec) {
                const pathSegments = reconstructPathFromInfo(minPerson, info);
                longestPathRecord = {
                    person: minPerson.label,
                    stopId: destStop,
                    accumulatedSec: accum,
                    pathSegments,
                };
            }

            const prevBest = minPerson.bestTimes.get(destStop);
            if (prevBest !== undefined && prevBest <= accum) {
                continue;
            }
            minPerson.bestTimes.set(destStop, accum);

            if (info.mode !== 'START') {
                minPerson.parent.set(destStop, { prevStop: info.from_stop, info });
            }

            const prevReach = minPerson.reachedStopFirst.get(destStop);
            if (!prevReach || accum < prevReach.elapsed) {
                minPerson.reachedStopFirst.set(destStop, { arrTime: info.arrive_sec, elapsed: accum });
            }

            if (persons.every(P => P.reachedStopFirst.has(destStop))) {
                meeting = { type: 'OK', stopId: destStop };
                updateIterationAnimation(iterations);
                break;
            }

            const curTime = info.arrive_sec;
            enqueuePathwayTransferWalks(minPerson.pq, destStop, curTime, accum, info.owner, midpoint);
            enqueueGeoWalks(minPerson.pq, destStop, curTime, accum, info.owner, midpoint);
            enqueueRides(minPerson.pq, destStop, curTime, accum, info.owner, midpoint);
        }

        updateIterationAnimation(Math.min(iterations, maxIterations));
    }
    finally {
        endIterationAnimation();
    }

    const totalVisitedNodes = persons.reduce((sum, person) => sum + person.bestTimes.size, 0);
    const queueSizes = persons.map(person => ({ label: person.label, size: person.pq.length }));
    if (!meeting && iterations > maxIterations) {
        terminationReason = terminationReason || `Search iteration safety cap of ${maxIterations.toLocaleString()} expansions was reached before a meeting point was found.`;
        terminationCode = terminationCode || 'ITERATION_LIMIT';
    }

    if (!meeting && capExceededDuringSearch && !terminationCode) {
        terminationReason = terminationReason || 'At least one participant exceeded the travel time cap without a meeting being found.';
        terminationCode = 'TRIP_CAP';
        if (lastCapExceededPerson) {
            meeting = { type: 'CAP', person: lastCapExceededPerson };
        }
    }

    if (longestPathRecord) {
        const segmentSummary = longestPathRecord.pathSegments.map(segment => {
            const from = segment.from_stop ?? 'START';
            const to = segment.to_stop ?? 'UNKNOWN';
            return `${segment.mode}:${from}->${to}`;
        });
        console.info('[Longest Path Summary]', {
            person: longestPathRecord.person,
            stopId: longestPathRecord.stopId,
            accumulatedSec: longestPathRecord.accumulatedSec,
            segments: segmentSummary,
        });
    }

    const stats = {
        totalVisitedNodes,
        maxAccumulatedTime: globalMaxAccum,
        terminationReason,
        terminationCode,
        queueSizes,
        iterations,
        longestPath: longestPathRecord,
        capExceededDuringSearch,
    };

    if (!meeting && terminationCode === 'ITERATION_LIMIT') {
        console.warn('Search halted because iteration safety cap was reached.', {
            maxIterations,
            iterations,
            queueSizes,
        });
    } else if (!meeting && terminationCode === 'EMPTY_QUEUE') {
        console.warn('Search halted because all participant queues were exhausted.', {
            iterations,
        });
    }

    return { meeting, persons, stats };
}

export async function findMeetingPoint() {
    try {
        if (gtfsData.stops.length === 0) {
            setStatus('Please upload GTFS files first!', 'error');
            return;
        }

        // Clear previous results and show progress bar
        const resultsDiv = document.getElementById('results');
        if (resultsDiv) {
            resultsDiv.innerHTML = '';
        }
        showProgress();
        startPreviewCountdown();

        const startTimeInput = document.getElementById('startTime');
        if (!startTimeInput) {
            setStatus('Start time input not found.', 'error');
            hideProgress();
            clearPreviewState('Preview cancelled because the start time was missing.');
            return;
        }

        const startTimeStr = startTimeInput.value + ':00';
        const t0 = toSeconds(startTimeStr);

        // Auto-resolve addresses
        setStatus('Resolving addresses...', 'loading');
        try {
            const resolvedAddresses = await autoResolveAllAddresses();
            const failed = resolvedAddresses.filter(r => r.failed);
            if (failed.length > 0) {
                const errorMsg = failed.map(f => `Person ${f.label}: ${f.error || 'Could not resolve address'}`).join('\n');
                setStatus(`Address resolution failed:\n${errorMsg}`, 'error');
                hideProgress();
                return;
            }
        } catch (error) {
            console.error('Error during auto-resolution:', error);
        }

        const validation = validatePeopleInputs(collectPersonInputs());
        if (!validation.ok) {
            setStatus(validation.error, 'error');
            hideProgress();
            clearPreviewState('Preview cancelled due to invalid participant inputs.');
            return;
        }

        setStatus('Searching for meeting point...', 'loading');

        // Force a repaint before starting search
        requestAnimationFrame(() => {
            requestAnimationFrame(async () => {
                try {
                    const { meeting, persons, stats } = await runMeetingSearch({
                        participants: validation.people,
                        startTimeSec: t0
                    });

                    hideProgress();
                    displayResults(meeting, persons, startTimeStr, stats);
                } catch (error) {
                    hideProgress();
                    setStatus('Error: ' + error.message, 'error');
                    clearPreviewState('Preview cancelled because an error occurred.');
                    console.error(error);
                }
            });
        });
    } catch (error) {
        hideProgress();
        setStatus('Error: ' + error.message, 'error');
        clearPreviewState('Preview cancelled because an error occurred.');
        console.error(error);
    }
}

export async function runHeatmapSearch({ participants, startTimeSec, onProgress, onStopUpdate, maxIterations = 200000000 }) {
    if (!Array.isArray(participants) || participants.length === 0) {
        throw new Error('No participants provided.');
    }

    if (gtfsData.stops.length === 0) {
        throw new Error('GTFS data has not been loaded.');
    }

    processGTFSData();

    const persons = participants.map(({ label, query, startStopId, isAddress, lat, lon }) => {
        // Handle address input - allow walking to any station within 1km
        if (isAddress && lat && lon) {
            return createPerson({
                label,
                stationId: null,
                stationName: query,
                startStopId: null,
                t0: startTimeSec,
                isAddress: true,
                addressLat: lat,
                addressLon: lon
            });
        }

        // Handle station name input
        const resolved = resolveStation(query);
        const stationId = resolved.stationId;
        const name = resolved.name;
        let chosenStart = startStopId;

        if (chosenStart) {
            const mappedStation = parsedData.stopIdToStationId.get(chosenStart);
            if (mappedStation && mappedStation !== stationId) {
                throw new Error(`Start platform ${chosenStart} does not belong to ${name}.`);
            }
        } else {
            chosenStart = pickStartPlatform(stationId, startTimeSec);
        }

        return createPerson({
            label,
            stationId,
            stationName: name,
            startStopId: chosenStart,
            t0: startTimeSec,
            isAddress: false
        });
    });

    // Calculate geographical midpoint of all participants' starting locations
    const startCoordinates = persons.map(p => {
        if (p.isAddress && p.addressLat && p.addressLon) {
            return { lat: p.addressLat, lon: p.addressLon };
        }
        return getStopCoordinates(p.startStopId);
    }).filter(c => c !== null);
    const midpoint = calculateGeographicMidpoint(startCoordinates);

    persons.forEach(person => primePerson(person, midpoint));

    // Track stops where all participants have arrived
    const commonStops = new Map(); // stopId -> { totalTime, maxTime, times: [] }
    let iterations = 0;
    // maxIterations is passed as parameter, defaults to 200000000
    let globalMaxAccum = 0;
    let lastProgressUpdateMinutes = 0;
    const PROGRESS_UPDATE_STEP_MIN = 0.5;
    let lastUIUpdateIteration = 0;
    const UI_UPDATE_INTERVAL = 5000; // Update UI every 5000 iterations

    try {
        while (iterations++ < maxIterations) {
            // Yield to browser every 1000 iterations for UI updates
            if (iterations % 1000 === 0) {
                await yieldToUI();
            }

            let minEntry = null;
            let minPerson = null;

            for (const S of persons) {
                if (S.pq.length > 0) {
                    const entry = S.pq.heap[0];
                    if (minEntry === null || entry.priority[0] < minEntry.priority[0]) {
                        minEntry = entry;
                        minPerson = S;
                    }
                }
            }

            if (!minEntry) {
                // All queues exhausted, we've explored everything
                break;
            }

            const accum = minEntry.priority[0];
            if (accum > globalMaxAccum) {
                globalMaxAccum = accum;
            }
            if (accum > MAX_TRIP_TIME_S) {
                // Skip nodes beyond time limit but continue searching
                minPerson.pq.pop();
                continue;
            }

            // Update progress bar based on the furthest elapsed travel time explored so far
            const exploredMinutes = globalMaxAccum / 60;
            if (exploredMinutes - lastProgressUpdateMinutes >= PROGRESS_UPDATE_STEP_MIN) {
                if (onProgress) {
                    const progressPercent = Math.min(100, (globalMaxAccum / MAX_TRIP_TIME_S) * 100);
                    onProgress(progressPercent, exploredMinutes, iterations, commonStops.size);
                }
                lastProgressUpdateMinutes = exploredMinutes;
            }

            const popped = minPerson.pq.pop();
            const info = popped.data;
            const destStop = info.to_stop;

            const prevBest = minPerson.bestTimes.get(destStop);
            if (prevBest !== undefined && prevBest <= accum) {
                continue;
            }
            minPerson.bestTimes.set(destStop, accum);

            if (info.mode !== 'START') {
                minPerson.parent.set(destStop, { prevStop: info.from_stop, info });
            }

            const prevReach = minPerson.reachedStopFirst.get(destStop);
            if (!prevReach || accum < prevReach.elapsed) {
                minPerson.reachedStopFirst.set(destStop, { arrTime: info.arrive_sec, elapsed: accum });
            }

            // Check if all participants have reached this stop
            if (persons.every(P => P.reachedStopFirst.has(destStop))) {
                // Calculate total and max times
                const times = persons.map(P => P.reachedStopFirst.get(destStop).elapsed);
                const totalTime = times.reduce((sum, t) => sum + t, 0);
                const maxTime = Math.max(...times); // Latest arrival time - when everyone has arrived

                // Only update if we found a better route to this stop (using maxTime for comparison)
                if (!commonStops.has(destStop) || maxTime < commonStops.get(destStop).maxTime) {
                    commonStops.set(destStop, { totalTime, maxTime, times });

                    // Update UI periodically with new stops
                    if (onStopUpdate && (iterations - lastUIUpdateIteration >= UI_UPDATE_INTERVAL)) {
                        const coords = getStopCoordinates(destStop);
                        if (coords) {
                            onStopUpdate(destStop, coords.lat, coords.lon, totalTime, maxTime);
                        }
                        lastUIUpdateIteration = iterations;
                    }
                }
            }

            const curTime = info.arrive_sec;
            enqueuePathwayTransferWalks(minPerson.pq, destStop, curTime, accum, info.owner, midpoint);
            enqueueGeoWalks(minPerson.pq, destStop, curTime, accum, info.owner, midpoint);
            enqueueRides(minPerson.pq, destStop, curTime, accum, info.owner, midpoint);
        }

        // Final update with all stops
        if (onProgress) {
            onProgress(100, globalMaxAccum / 60, iterations, commonStops.size);
        }

        // Convert commonStops to array with coordinates
        const results = [];
        for (const [stopId, data] of commonStops) {
            const coords = getStopCoordinates(stopId);
            if (coords) {
                results.push({
                    stopId,
                    lat: coords.lat,
                    lon: coords.lon,
                    totalTime: data.totalTime,
                    maxTime: data.maxTime,
                    times: data.times
                });
            }
        }

        // Calculate average travel time and count of reachable stations for single-person searches
        let avgTravelTime = null;
        let reachableStationsCount = null;

        if (persons.length === 1) {
            // For single person, calculate average time across all reached stations
            const person = persons[0];
            const reachedStops = Array.from(person.bestTimes.entries());
            reachableStationsCount = reachedStops.length;

            if (reachedStops.length > 0) {
                const totalTime = reachedStops.reduce((sum, [stopId, time]) => sum + time, 0);
                avgTravelTime = totalTime / reachedStops.length;
            }
        }

        return {
            results,
            iterations,
            maxAccumulatedTime: globalMaxAccum,
            totalStopsReached: commonStops.size,
            persons, // Return persons data for single-source analysis
            avgTravelTime, // Average travel time for single-person searches (in seconds)
            reachableStationsCount // Number of stations reachable for single-person searches
        };
    } finally {
        // Cleanup
    }
}

export async function runDeterministicRouteSelfCheck() {
    if (gtfsData.stops.length === 0) {
        return {
            success: false,
            message: 'Self-check could not run because GTFS data is missing.',
        };
    }

    try {
        const startTimeSec = toSeconds('10:04:30');
        const participants = [
            {
                label: 'A',
                query: 'U Gleisdreieck (Berlin)',
                startStopId: 'de:11000:900017103::4'
            },
            {
                label: 'B',
                query: 'S+U Pankow (Berlin)',
                startStopId: 'de:11000:900130002::2'
            }
        ];

        const { meeting, stats } = await runMeetingSearch({ participants, startTimeSec });

        if (meeting && meeting.type === 'OK') {
            return {
                success: true,
                message: 'Self-check passed: deterministic U2 route search succeeded.',
                meetingStopId: meeting.stopId,
                stats,
                startTimeSec,
                participants,
            };
        }

        let failureReason = stats?.terminationReason || 'Unknown reason';
        if (meeting && meeting.type === 'CAP') {
            failureReason = `Travel cap exceeded for Person ${meeting.person.label}`;
        }

        return {
            success: false,
            message: `Self-check failed: ${failureReason}.`,
            meetingStopId: meeting?.stopId ?? null,
            stats,
            startTimeSec,
            participants,
        };
    } catch (error) {
        return {
            success: false,
            message: `Self-check error: ${error.message}`,
        };
    }
}
