// Global state
let gtfsData = {
    stops: [],
    stopTimes: [],
    trips: [],
    routes: [],
    pathways: [],
    transfers: []
};

let parsedData = {
    stopById: new Map(),
    stationToName: new Map(),
    stopIdToStationId: new Map(),
    stationToPlatforms: new Map(),
    rowsAtStop: new Map(),
    tripGroups: new Map(),
    tripInfo: new Map(),
    routeInfo: new Map(),
    walkEdges: new Map(),
    providedPairs: new Set(),
    grid: new Map()
};

const WALK_SPEED_MPS = 1.3;
const MAX_WALK_TIME_S = 10 * 60;
const MAX_WALK_RADIUS_M = WALK_SPEED_MPS * MAX_WALK_TIME_S;
const MAX_TRIP_TIME_S = 2 * 60 * 60;
const DLAT = 0.004;
const DLON = 0.007;

// Auto-load GTFS files from gtfs_subset folder
async function loadGTFSFiles() {
    setStatus('Loading GTFS files...', 'loading');

    const files = [
        'stops.txt',
        'stop_times.txt',
        'trips.txt',
        'routes.txt',
        'pathways.txt',
        'transfers.txt'
    ];

    try {
        for (const fileName of files) {
            const response = await fetch(`gtfs_subset/${fileName}`);
            if (!response.ok) {
                throw new Error(`Failed to load ${fileName}`);
            }
            const text = await response.text();

            if (fileName === 'stops.txt') {
                gtfsData.stops = parseCSV(text);
            } else if (fileName === 'stop_times.txt') {
                gtfsData.stopTimes = parseCSV(text);
            } else if (fileName === 'trips.txt') {
                gtfsData.trips = parseCSV(text);
            } else if (fileName === 'routes.txt') {
                gtfsData.routes = parseCSV(text);
            } else if (fileName === 'pathways.txt') {
                gtfsData.pathways = parseCSV(text);
            } else if (fileName === 'transfers.txt') {
                gtfsData.transfers = parseCSV(text);
            }
        }

        setStatus('GTFS files loaded successfully! Ready to find meeting points.', 'success');
        document.getElementById('findMeeting').disabled = false;
    } catch (error) {
        setStatus('Error loading GTFS files: ' + error.message, 'error');
        console.error(error);
    }
}

// Load files on page load
window.addEventListener('DOMContentLoaded', loadGTFSFiles);

function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const obj = {};
            headers.forEach((header, idx) => {
                obj[header] = values[idx];
            });
            data.push(obj);
        }
    }

    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function toSeconds(hms) {
    if (!hms) return null;
    const match = hms.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, h, m, s] = match.map(Number);
    return h * 3600 + m * 60 + s;
}

function sec2hm(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000.0;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180;
    const dlambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function cellFor(lat, lon) {
    return `${Math.floor(lat / DLAT)},${Math.floor(lon / DLON)}`;
}

function processGTFSData() {
    setStatus('Processing GTFS data...', 'loading');

    // Build stop lookup
    gtfsData.stops.forEach(stop => {
        parsedData.stopById.set(stop.stop_id, stop);
    });

    // Build station mappings
    gtfsData.stops.forEach(stop => {
        const stationId = stop.parent_station || stop.stop_id;
        parsedData.stopIdToStationId.set(stop.stop_id, stationId);

        if (!parsedData.stationToPlatforms.has(stationId)) {
            parsedData.stationToPlatforms.set(stationId, []);
        }
        parsedData.stationToPlatforms.get(stationId).push(stop.stop_id);
    });

    // Build station names
    const stationNames = new Map();
    gtfsData.stops.forEach(stop => {
        const stationId = parsedData.stopIdToStationId.get(stop.stop_id);
        const name = stop.stop_desc || stop.stop_name || stop.stop_id;
        if (!stationNames.has(stationId)) {
            stationNames.set(stationId, new Map());
        }
        const nameCount = stationNames.get(stationId);
        nameCount.set(name, (nameCount.get(name) || 0) + 1);
    });

    stationNames.forEach((names, stationId) => {
        const sorted = Array.from(names.entries()).sort((a, b) => b[1] - a[1]);
        parsedData.stationToName.set(stationId, sorted[0][0]);
    });

    // Process stop times
    const stopTimesWithSec = gtfsData.stopTimes.map(st => ({
        ...st,
        dep_sec: toSeconds(st.departure_time),
        arr_sec: toSeconds(st.arrival_time),
        stop_sequence: parseInt(st.stop_sequence) || 0
    })).filter(st => st.dep_sec !== null);

    // Group by stop_id
    stopTimesWithSec.forEach(st => {
        if (!parsedData.rowsAtStop.has(st.stop_id)) {
            parsedData.rowsAtStop.set(st.stop_id, []);
        }
        parsedData.rowsAtStop.get(st.stop_id).push(st);
    });

    // Sort each stop's departures
    parsedData.rowsAtStop.forEach((rows, stopId) => {
        rows.sort((a, b) => a.dep_sec - b.dep_sec);
    });

    // Group by trip_id
    stopTimesWithSec.forEach(st => {
        if (!parsedData.tripGroups.has(st.trip_id)) {
            parsedData.tripGroups.set(st.trip_id, []);
        }
        parsedData.tripGroups.get(st.trip_id).push(st);
    });

    // Sort trip sequences
    parsedData.tripGroups.forEach((stops, tripId) => {
        stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
    });

    // Build trip info
    gtfsData.trips.forEach(trip => {
        parsedData.tripInfo.set(trip.trip_id, {
            route_id: trip.route_id,
            trip_headsign: trip.trip_headsign || '',
            direction_id: trip.direction_id,
            shape_id: trip.shape_id
        });
    });

    // Build route info
    gtfsData.routes.forEach(route => {
        parsedData.routeInfo.set(route.route_id, {
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_type: route.route_type,
            agency_id: route.agency_id
        });
    });

    // Build walk edges from pathways
    gtfsData.pathways.forEach(pw => {
        const from = pw.from_stop_id;
        const to = pw.to_stop_id;
        const ttime = parseInt(pw.traversal_time);
        if (from && to && ttime) {
            const finalTime = Math.max(30, ttime);
            if (!parsedData.walkEdges.has(from)) {
                parsedData.walkEdges.set(from, []);
            }
            parsedData.walkEdges.get(from).push({ to, time: finalTime, source: 'PATHWAYS' });
            parsedData.providedPairs.add(`${from}-${to}`);
        }
    });

    // Build walk edges from transfers
    gtfsData.transfers.forEach(tf => {
        const from = tf.from_stop_id;
        const to = tf.to_stop_id;
        const ttime = parseInt(tf.min_transfer_time);
        if (from && to && ttime) {
            const finalTime = Math.max(30, ttime);
            if (!parsedData.walkEdges.has(from)) {
                parsedData.walkEdges.set(from, []);
            }
            parsedData.walkEdges.get(from).push({ to, time: finalTime, source: 'TRANSFERS' });
            parsedData.providedPairs.add(`${from}-${to}`);
        }
    });

    // Build spatial grid
    gtfsData.stops.forEach(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (!isNaN(lat) && !isNaN(lon)) {
            const cell = cellFor(lat, lon);
            if (!parsedData.grid.has(cell)) {
                parsedData.grid.set(cell, []);
            }
            parsedData.grid.get(cell).push(stop.stop_id);
        }
    });

    setStatus('GTFS data processed successfully!', 'success');
}

function resolveStation(query) {
    const q = query.toLowerCase().trim();
    const matches = [];

    parsedData.stationToName.forEach((name, stationId) => {
        if (name.toLowerCase().includes(q)) {
            matches.push({ stationId, name });
        }
    });

    if (matches.length === 0) {
        throw new Error(`No station matches '${query}'`);
    }

    matches.sort((a, b) => a.name.localeCompare(b.name));
    return matches[0];
}

function pickStartPlatform(stationId, t0) {
    const platforms = parsedData.stationToPlatforms.get(stationId) || [];
    let bestSid = null;
    let bestDep = null;

    for (const sid of platforms) {
        const rows = parsedData.rowsAtStop.get(sid) || [];
        const validDeps = rows.filter(r => r.dep_sec >= t0);
        if (validDeps.length > 0) {
            const candDep = validDeps[0].dep_sec;
            if (bestDep === null || candDep < bestDep) {
                bestDep = candDep;
                bestSid = sid;
            }
        }
    }

    if (bestSid === null && platforms.length > 0) {
        bestSid = platforms[0];
    }

    return bestSid;
}

function nearbyStopsWithinRadius(stopId, radiusM) {
    const stop = parsedData.stopById.get(stopId);
    if (!stop) return [];

    const lat0 = parseFloat(stop.stop_lat);
    const lon0 = parseFloat(stop.stop_lon);
    const cell0 = cellFor(lat0, lon0);
    const [cy, cx] = cell0.split(',').map(Number);

    const mPerDegLat = 111320.0;
    const mPerDegLon = 111320.0 * Math.cos(lat0 * Math.PI / 180);
    const nlat = Math.ceil((radiusM / mPerDegLat) / DLAT) + 1;
    const nlon = Math.ceil((radiusM / mPerDegLon) / DLON) + 1;

    const nearby = [];
    const seen = new Set();

    for (let di = -nlat; di <= nlat; di++) {
        for (let dj = -nlon; dj <= nlon; dj++) {
            const cell = `${cy + di},${cx + dj}`;
            const candidates = parsedData.grid.get(cell) || [];
            for (const cand of candidates) {
                if (cand === stopId || seen.has(cand)) continue;
                seen.add(cand);

                const candStop = parsedData.stopById.get(cand);
                if (candStop) {
                    const lat1 = parseFloat(candStop.stop_lat);
                    const lon1 = parseFloat(candStop.stop_lon);
                    const dist = haversineM(lat0, lon0, lat1, lon1);
                    if (dist <= radiusM) {
                        nearby.push({ stopId: cand, distance: dist });
                    }
                }
            }
        }
    }

    return nearby;
}

// Priority queue implementation
class MinHeap {
    constructor() {
        this.heap = [];
        this.counter = 0;
    }

    push(priority, data) {
        this.counter++;
        this.heap.push({ priority, counter: this.counter, data });
        this.bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        return min;
    }

    bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2);
            if (this.compare(this.heap[idx], this.heap[parentIdx]) >= 0) break;
            [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
            idx = parentIdx;
        }
    }

    bubbleDown(idx) {
        while (true) {
            let minIdx = idx;
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;

            if (left < this.heap.length && this.compare(this.heap[left], this.heap[minIdx]) < 0) {
                minIdx = left;
            }
            if (right < this.heap.length && this.compare(this.heap[right], this.heap[minIdx]) < 0) {
                minIdx = right;
            }

            if (minIdx === idx) break;
            [this.heap[idx], this.heap[minIdx]] = [this.heap[minIdx], this.heap[idx]];
            idx = minIdx;
        }
    }

    compare(a, b) {
        // Compare priority tuples: [accum, arrTime, destStop]
        for (let i = 0; i < a.priority.length; i++) {
            if (a.priority[i] < b.priority[i]) return -1;
            if (a.priority[i] > b.priority[i]) return 1;
        }
        return a.counter - b.counter;
    }

    get length() {
        return this.heap.length;
    }
}

function enqueuePathwayTransferWalks(pq, curStop, curTime, accum, owner) {
    const edges = parsedData.walkEdges.get(curStop) || [];
    for (const edge of edges) {
        pq.push(
            [accum + edge.time, curTime + edge.time, edge.to],
            {
                owner, mode: 'WALK', source: edge.source,
                from_stop: curStop, to_stop: edge.to,
                walk_sec: edge.time,
                depart_sec: curTime, arrive_sec: curTime + edge.time
            }
        );
    }
}

function enqueueGeoWalks(pq, curStop, curTime, accum, owner) {
    const nearby = nearbyStopsWithinRadius(curStop, MAX_WALK_RADIUS_M);
    for (const { stopId: cand, distance: distM } of nearby) {
        if (parsedData.providedPairs.has(`${curStop}-${cand}`)) continue;
        let ttime = Math.ceil(distM / WALK_SPEED_MPS);
        ttime = Math.max(30, ttime);
        if (ttime <= MAX_WALK_TIME_S) {
            pq.push(
                [accum + ttime, curTime + ttime, cand],
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

function enqueueRides(pq, curStop, curTime, accum, owner) {
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

            pq.push(
                [accum + total, arrTime, arrRow.stop_id],
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

function fmtStopLabel(stopId) {
    const stop = parsedData.stopById.get(stopId);
    const stationId = parsedData.stopIdToStationId.get(stopId) || stopId;
    const stationName = parsedData.stationToName.get(stationId) || stationId;
    const platformName = stop?.stop_desc || stop?.stop_name || stopId;
    return `${platformName} [${stopId}] • ${stationName} [${stationId}]`;
}

function describeAction(info) {
    if (info.mode === 'WALK') {
        const extra = info.source === 'GEO' && info.distance_m ? ` (≈${info.distance_m} m)` : '';
        const src = info.source || '';
        return `WALK${src ? ` (${src})` : ''}: ${sec2hm(info.depart_sec)} ${fmtStopLabel(info.from_stop)} → ${fmtStopLabel(info.to_stop)} in ${Math.floor(info.walk_sec / 60)} min${extra}`;
    } else if (info.mode === 'START') {
        return `START at ${sec2hm(info.depart_sec)} from ${fmtStopLabel(info.to_stop)}`;
    } else {
        const routeInf = parsedData.routeInfo.get(info.route_id);
        const rshort = routeInf?.route_short_name || '?';
        const rtype = routeInf?.route_type || '';
        return `RIDE: ${sec2hm(info.depart_sec)} ${fmtStopLabel(info.from_stop)} → ${fmtStopLabel(info.to_stop)} • wait ${Math.floor(info.wait_sec / 60)} min, ride ${Math.floor(info.ride_sec / 60)} min on ${rshort} '${info.headsign}'`;
    }
}

function findMeetingPoint() {
    try {
        if (gtfsData.stops.length === 0) {
            setStatus('Please upload GTFS files first!', 'error');
            return;
        }

        setStatus('Processing GTFS data...', 'loading');
        processGTFSData();

        const startTimeStr = document.getElementById('startTime').value + ':00';
        const t0 = toSeconds(startTimeStr);

        const person1Query = document.getElementById('person1').value;
        const person2Query = document.getElementById('person2').value;

        const peopleInputs = [
            { label: 'A', query: person1Query },
            { label: 'B', query: person2Query }
        ];

        setStatus('Initializing search...', 'loading');

        // Build person structures
        const persons = [];
        for (const { label, query } of peopleInputs) {
            const { stationId, name } = resolveStation(query);
            const startStopId = pickStartPlatform(stationId, t0);

            persons.push({
                label,
                stationId,
                stationName: name,
                startStopId,
                t0,
                pq: new MinHeap(),
                visitedStops: new Set(),
                reachedStopFirst: new Map(),
                parent: new Map()
            });
        }

        // Seed queues
        for (const S of persons) {
            S.pq.push(
                [0, S.t0, S.startStopId],
                { owner: S.label, mode: 'START', from_stop: null, to_stop: S.startStopId, depart_sec: S.t0, arrive_sec: S.t0 }
            );
            enqueuePathwayTransferWalks(S.pq, S.startStopId, S.t0, 0, S.label);
            enqueueGeoWalks(S.pq, S.startStopId, S.t0, 0, S.label);
            enqueueRides(S.pq, S.startStopId, S.t0, 0, S.label);
        }

        setStatus('Searching for meeting point...', 'loading');

        let meeting = null;
        let iterations = 0;
        const maxIterations = 100000;

        while (iterations++ < maxIterations) {
            // Pop globally minimum
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

            if (!minEntry) break;

            const accum = minEntry.priority[0];
            if (accum > MAX_TRIP_TIME_S) {
                meeting = { type: 'CAP', person: minPerson };
                break;
            }

            const popped = minPerson.pq.pop();
            const info = popped.data;
            const destStop = info.to_stop;

            if (minPerson.visitedStops.has(destStop)) continue;
            minPerson.visitedStops.add(destStop);

            if (info.mode !== 'START') {
                minPerson.parent.set(destStop, { prevStop: info.from_stop, info });
            }

            if (!minPerson.reachedStopFirst.has(destStop)) {
                minPerson.reachedStopFirst.set(destStop, { arrTime: info.arrive_sec, elapsed: accum });
            }

            // Check if all persons reached this stop
            if (persons.every(P => P.reachedStopFirst.has(destStop))) {
                meeting = { type: 'OK', stopId: destStop };
                break;
            }

            // Expand
            const curTime = info.arrive_sec;
            enqueuePathwayTransferWalks(minPerson.pq, destStop, curTime, accum, info.owner);
            enqueueGeoWalks(minPerson.pq, destStop, curTime, accum, info.owner);
            enqueueRides(minPerson.pq, destStop, curTime, accum, info.owner);
        }

        displayResults(meeting, persons, startTimeStr);

    } catch (error) {
        setStatus('Error: ' + error.message, 'error');
        console.error(error);
    }
}

function reconstructPath(person, stopId) {
    const path = [];
    let cur = stopId;
    while (person.parent.has(cur)) {
        const { prevStop, info } = person.parent.get(cur);
        path.unshift(info);
        cur = prevStop;
    }
    return path;
}

function displayResults(meeting, persons, startTimeStr) {
    const resultsDiv = document.getElementById('results');

    if (!meeting) {
        resultsDiv.innerHTML = '<div class="status-error">No meeting found before search exhausted.</div>';
        setStatus('Search complete - no meeting found', 'error');
        return;
    }

    if (meeting.type === 'CAP') {
        resultsDiv.innerHTML = `<div class="status-error">Search stopped: Person ${meeting.person.label} exceeded 2-hour travel time cap.</div>`;
        setStatus('Search capped', 'error');
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
            <p><strong>Fairness:</strong> ${arrivals.map(a => `${a.label}: ${Math.floor(a.elapsed / 60)} min`).join(', ')} |
               Max: ${Math.floor(maxElapsed / 60)} min | Diff: ${Math.floor((maxElapsed - minElapsed) / 60)} min</p>
        </div>
    `;

    for (const S of persons) {
        const { arrTime, elapsed } = S.reachedStopFirst.get(stopId);
        const path = reconstructPath(S, stopId);

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
}

function setStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
}
