import { MAX_TRIP_TIME_S, MAX_WALK_RADIUS_M, WALK_SPEED_MPS, MAX_WALK_TIME_S } from './constants.js';
import { gtfsData, parsedData } from './state.js';
import { processGTFSData, resolveStation, pickStartPlatform, nearbyStopsWithinRadius } from './gtfsProcessing.js';
import { MinHeap } from './queue.js';
import { toSeconds } from './parsing.js';
import { displayResults, setStatus } from './ui.js';

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

export function findMeetingPoint() {
    try {
        if (gtfsData.stops.length === 0) {
            setStatus('Please upload GTFS files first!', 'error');
            return;
        }

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

            if (persons.every(P => P.reachedStopFirst.has(destStop))) {
                meeting = { type: 'OK', stopId: destStop };
                break;
            }

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
