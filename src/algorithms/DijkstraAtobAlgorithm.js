import { AlgorithmInterface } from './AlgorithmInterface.js';
import { MAX_TRIP_TIME_S } from '../constants.js';
import { parsedData } from '../state.js';
import { processGTFSData, nearbyStopsWithinRadius } from '../gtfsProcessing.js';
import { MinHeap } from '../queue.js';
import { resolvePointToStops, resolveDestinationToStops } from '../core/routingUtils.js';

const MIN_TRAVEL_TIME_S = 10;

/**
 * Original Dijkstra-based A→B routing algorithm
 * Uses time-expanded graph with priority queue
 */
export class DijkstraAtobAlgorithm extends AlgorithmInterface {
    constructor() {
        super();
        this.lastStats = null;
    }

    getName() {
        return 'Dijkstra';
    }

    getDescription() {
        return 'Original time-expanded Dijkstra algorithm (guaranteed optimal)';
    }

    async searchRoutes({ startPoint, endPoint, startTimeSec, maxRoutes = 3 }) {
        processGTFSData();

        const startTime = performance.now();
        const routes = [];
        const visited = new Map();
        const pq = new MinHeap();

        // Initialize start point
        const startStops = resolvePointToStops(startPoint, startTimeSec);

        // Initialize destination
        const endStops = resolveDestinationToStops(endPoint);
        const endStopSet = new Set(endStops.map(s => s.stopId));

        // Add starting points to queue
        for (const start of startStops) {
            pq.push([start.walkTime, startTimeSec + start.walkTime, start.stopId], {
                stopId: start.stopId,
                arrivalTime: startTimeSec + start.walkTime,
                startStopId: start.stopId,
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

        while (pq.length > 0 && iterations++ < maxIterations && routes.length < maxRoutes) {
            const entry = pq.pop();
            const [accum, currentTime, currentStop] = entry.priority;
            const { path, startStopId } = entry.data;

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
                    path: finalPath,
                    startStopId,
                    destStopId: endStopInfo.stopId
                });

                if (routes.length >= maxRoutes) break;
                continue;
            }

            if (accum > MAX_TRIP_TIME_S) continue;

            // Expand: pathway/transfer walks
            const walkEdges = parsedData.walkEdges.get(currentStop) || [];
            for (const edge of walkEdges) {
                const travelTime = Math.max(MIN_TRAVEL_TIME_S, edge.time);
                const newTime = currentTime + travelTime;

                pq.push([accum + travelTime, newTime, edge.to], {
                    stopId: edge.to,
                    arrivalTime: newTime,
                    startStopId,
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
                const walkTime = Math.ceil(distM / 1.4); // WALK_SPEED_MPS
                if (walkTime > MIN_TRAVEL_TIME_S) {
                    const newTime = currentTime + walkTime;

                    pq.push([accum + walkTime, newTime, nbr.stopId], {
                        stopId: nbr.stopId,
                        arrivalTime: newTime,
                        startStopId,
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
                        startStopId,
                        path: [...path, {
                            mode: 'TRANSIT',
                            route_short_name: tripInf?.route_short_name || tripInf?.route_id,
                            trip_headsign: tripInf?.trip_headsign || '',
                            from_stop: currentStop,
                            to_stop: arrRow.stop_id,
                            board_sec: depTime,
                            alight_sec: arrTime,
                            depart_sec: currentTime,
                            arrive_sec: arrTime,
                            trip_id: tripId
                        }]
                    });
                }
            }
        }

        const endTime = performance.now();
        this.lastStats = {
            algorithm: this.getName(),
            iterations,
            visitedNodes: visited.size,
            routesFound: routes.length,
            executionTimeMs: endTime - startTime
        };

        return routes;
    }

    getStats() {
        return this.lastStats;
    }
}
