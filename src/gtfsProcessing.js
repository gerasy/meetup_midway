import { MAX_STATION_SUGGESTIONS, DLAT, DLON } from './constants.js';
import { gtfsData, parsedData, appState, resetParsedDataCollections } from './state.js';
import { haversineM, cellFor } from './geometry.js';
import { toSeconds } from './parsing.js';
import { setStatus } from './ui.js';

function getRankedStationMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
        return [];
    }

    const matches = [];
    for (const item of appState.stationLookupList) {
        const idx = item.lowerName.indexOf(q);
        if (idx === -1) {
            continue;
        }

        let score = 1;
        if (item.lowerName === q) {
            score = 3;
        } else if (idx === 0) {
            score = 2;
        }

        matches.push({ item, score, idx });
    }

    matches.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        if (b.item.popularity !== a.item.popularity) {
            return b.item.popularity - a.item.popularity;
        }
        if (a.idx !== b.idx) {
            return a.idx - b.idx;
        }
        return a.item.name.localeCompare(b.item.name);
    });

    const seenNames = new Set();
    const uniqueMatches = [];
    for (const match of matches) {
        const key = match.item.lowerName;
        if (seenNames.has(key)) {
            continue;
        }
        seenNames.add(key);
        uniqueMatches.push(match);
    }

    return uniqueMatches;
}

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

    const stationNameInfo = new Map();
    gtfsData.stops.forEach(stop => {
        const stationId = parsedData.stopIdToStationId.get(stop.stop_id);
        if (!stationNameInfo.has(stationId)) {
            stationNameInfo.set(stationId, { officialName: null, nameCounts: new Map() });
        }

        const info = stationNameInfo.get(stationId);
        const stopName = (stop.stop_name || '').trim();
        const locationType = stop.location_type;
        const isStationRecord = locationType === '1' || locationType === 1;

        if (stopName) {
            info.nameCounts.set(stopName, (info.nameCounts.get(stopName) || 0) + 1);
        }

        if (isStationRecord && stopName) {
            info.officialName = stopName;
        } else if (!info.officialName && stop.stop_id === stationId && stopName) {
            info.officialName = stopName;
        }
    });

    stationNameInfo.forEach((info, stationId) => {
        const sorted = Array.from(info.nameCounts.entries()).sort((a, b) => b[1] - a[1]);
        const fallbackName = sorted.length > 0 ? sorted[0][0] : stationId;
        const name = info.officialName || fallbackName;
        parsedData.stationToName.set(stationId, name);
    });

    const stopTimesWithSec = gtfsData.stopTimes.map(st => ({
        ...st,
        dep_sec: toSeconds(st.departure_time),
        arr_sec: toSeconds(st.arrival_time),
        stop_sequence: parseInt(st.stop_sequence, 10) || 0
    })).filter(st => st.dep_sec !== null);

    parsedData.stationPopularity.clear();
    stopTimesWithSec.forEach(st => {
        const stationId = parsedData.stopIdToStationId.get(st.stop_id);
        if (!stationId) {
            return;
        }
        const prev = parsedData.stationPopularity.get(stationId) || 0;
        parsedData.stationPopularity.set(stationId, prev + 1);
    });

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

    const rawStationLookup = Array.from(parsedData.stationToName.entries()).map(([stationId, name]) => {
        const popularity = parsedData.stationPopularity.get(stationId) || 0;
        return {
            stationId,
            name,
            lowerName: name.toLowerCase(),
            popularity
        };
    });

    const bestByName = new Map();
    for (const entry of rawStationLookup) {
        const existing = bestByName.get(entry.lowerName);
        if (!existing || entry.popularity > existing.popularity) {
            bestByName.set(entry.lowerName, entry);
        }
    }

    appState.stationLookupList = Array.from(bestByName.values());

    appState.stationLookupList.sort((a, b) => {
        if (b.popularity !== a.popularity) {
            return b.popularity - a.popularity;
        }
        return a.name.localeCompare(b.name);
    });

    appState.isDataProcessed = true;
    initializeStationSearchInputs();
    setStatus('GTFS data processed successfully!', 'success');
}

export function initializeStationSearchInputs() {
    if (typeof document === 'undefined') {
        return;
    }

    const inputs = document.querySelectorAll('input[data-station-input]');
    if (inputs.length === 0) {
        return;
    }

    const updateSuggestions = (input, datalist, query) => {
        let matches = [];

        if (!query) {
            matches = appState.stationLookupList.slice(0, MAX_STATION_SUGGESTIONS);
        } else if (query.length >= 2) {
            matches = getRankedStationMatches(query)
                .slice(0, MAX_STATION_SUGGESTIONS)
                .map(match => match.item);
        }

        datalist.innerHTML = '';
        const seen = new Set();
        matches.forEach(({ name }) => {
            const key = name.trim().toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    };

    inputs.forEach(input => {
        if (input.dataset.stationReady === 'true') {
            return;
        }
        const listId = input.getAttribute('list');
        if (!listId) {
            return;
        }
        const datalist = document.getElementById(listId);
        if (!datalist) {
            return;
        }

        const handler = () => {
            const query = input.value.trim().toLowerCase();
            if (input.dataset.lastSuggestionQuery === query) {
                return;
            }
            input.dataset.lastSuggestionQuery = query;
            updateSuggestions(input, datalist, query);
        };
        input.addEventListener('input', handler);
        input.addEventListener('focus', handler);
        handler();
        input.dataset.stationReady = 'true';
    });

    appState.stationSearchInitialized = true;
}

export function resolveStation(query) {
    const trimmed = query.trim();
    if (!trimmed) {
        throw new Error('Please enter a station name.');
    }

    const matches = getRankedStationMatches(trimmed);
    if (matches.length === 0) {
        throw new Error(`No station matches '${query}'`);
    }

    const best = matches[0].item;
    return { stationId: best.stationId, name: best.name };
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
