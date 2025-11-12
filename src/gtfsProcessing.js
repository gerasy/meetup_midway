import { MAX_STATION_SUGGESTIONS, DLAT, DLON } from './constants.js';
import { gtfsData, parsedData, appState, resetParsedDataCollections } from './state.js';
import { haversineM, cellFor } from './geometry.js';
import { toSeconds } from './parsing.js';
import { setStatus } from './ui.js';

export function processGTFSData() {
    if (appState.isDataProcessed) {
        return;
    }

    setStatus('Processing GTFS data...', 'loading');
    resetParsedDataCollections();

    gtfsData.stops.forEach(stop => {
        parsedData.stopById.set(stop.stop_id, stop);
    });

    gtfsData.stops.forEach(stop => {
        const stationId = stop.parent_station || stop.stop_id;
        parsedData.stopIdToStationId.set(stop.stop_id, stationId);

        if (!parsedData.stationToPlatforms.has(stationId)) {
            parsedData.stationToPlatforms.set(stationId, []);
        }
        parsedData.stationToPlatforms.get(stationId).push(stop.stop_id);
    });

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

    const stopTimesWithSec = gtfsData.stopTimes.map(st => ({
        ...st,
        dep_sec: toSeconds(st.departure_time),
        arr_sec: toSeconds(st.arrival_time),
        stop_sequence: parseInt(st.stop_sequence, 10) || 0
    })).filter(st => st.dep_sec !== null);

    stopTimesWithSec.forEach(st => {
        if (!parsedData.rowsAtStop.has(st.stop_id)) {
            parsedData.rowsAtStop.set(st.stop_id, []);
        }
        parsedData.rowsAtStop.get(st.stop_id).push(st);
    });

    parsedData.rowsAtStop.forEach(rows => {
        rows.sort((a, b) => a.dep_sec - b.dep_sec);
    });

    stopTimesWithSec.forEach(st => {
        if (!parsedData.tripGroups.has(st.trip_id)) {
            parsedData.tripGroups.set(st.trip_id, []);
        }
        parsedData.tripGroups.get(st.trip_id).push(st);
    });

    parsedData.tripGroups.forEach(stops => {
        stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
    });

    gtfsData.trips.forEach(trip => {
        parsedData.tripInfo.set(trip.trip_id, {
            route_id: trip.route_id,
            trip_headsign: trip.trip_headsign || '',
            direction_id: trip.direction_id,
            shape_id: trip.shape_id
        });
    });

    gtfsData.routes.forEach(route => {
        parsedData.routeInfo.set(route.route_id, {
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_type: route.route_type,
            agency_id: route.agency_id
        });
    });

    gtfsData.pathways.forEach(pw => {
        const from = pw.from_stop_id;
        const to = pw.to_stop_id;
        const ttime = parseInt(pw.traversal_time, 10);
        if (from && to && ttime) {
            const finalTime = Math.max(30, ttime);
            if (!parsedData.walkEdges.has(from)) {
                parsedData.walkEdges.set(from, []);
            }
            parsedData.walkEdges.get(from).push({ to, time: finalTime, source: 'PATHWAYS' });
            parsedData.providedPairs.add(`${from}-${to}`);
        }
    });

    gtfsData.transfers.forEach(tf => {
        const from = tf.from_stop_id;
        const to = tf.to_stop_id;
        const ttime = parseInt(tf.min_transfer_time, 10);
        if (from && to && ttime) {
            const finalTime = Math.max(30, ttime);
            if (!parsedData.walkEdges.has(from)) {
                parsedData.walkEdges.set(from, []);
            }
            parsedData.walkEdges.get(from).push({ to, time: finalTime, source: 'TRANSFERS' });
            parsedData.providedPairs.add(`${from}-${to}`);
        }
    });

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

    appState.stationLookupList = Array.from(parsedData.stationToName.entries()).map(([stationId, name]) => ({
        stationId,
        name,
        lowerName: name.toLowerCase()
    })).sort((a, b) => a.name.localeCompare(b.name));

    appState.isDataProcessed = true;
    initializeStationSearchInputs();
    setStatus('GTFS data processed successfully!', 'success');
}

export function initializeStationSearchInputs() {
    if (appState.stationSearchInitialized) {
        return;
    }

    const inputs = document.querySelectorAll('input[data-station-input]');
    if (inputs.length === 0) {
        return;
    }

    const updateSuggestions = (input, datalist) => {
        const query = input.value.trim().toLowerCase();
        let matches;

        if (!query) {
            matches = appState.stationLookupList.slice(0, MAX_STATION_SUGGESTIONS);
        } else {
            matches = appState.stationLookupList
                .filter(item => item.lowerName.includes(query))
                .slice(0, MAX_STATION_SUGGESTIONS);
        }

        datalist.innerHTML = '';
        matches.forEach(({ name }) => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    };

    inputs.forEach(input => {
        const listId = input.getAttribute('list');
        if (!listId) {
            return;
        }
        const datalist = document.getElementById(listId);
        if (!datalist) {
            return;
        }

        const handler = () => updateSuggestions(input, datalist);
        input.addEventListener('input', handler);
        input.addEventListener('focus', handler);
        handler();
    });

    appState.stationSearchInitialized = true;
}

export function resolveStation(query) {
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

export function pickStartPlatform(stationId, t0) {
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

export function nearbyStopsWithinRadius(stopId, radiusM) {
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
