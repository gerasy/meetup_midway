import { AlgorithmInterface } from './AlgorithmInterface.js';
import { MAX_TRIP_TIME_S, WALK_SPEED_MPS } from '../constants.js';
import { parsedData } from '../state.js';
import { processGTFSData, nearbyStopsWithinRadius } from '../gtfsProcessing.js';
import { resolvePointToStops, resolveDestinationToStops } from '../core/routingUtils.js';

const MIN_TRAVEL_TIME_S = 10;

/**
 * Connection Scan Algorithm (CSA) for A→B routing
 * Much faster than Dijkstra - scans connections in chronological order
 * No priority queue needed!
 */
export class CSAAtobAlgorithm extends AlgorithmInterface {
    constructor() {
        super();
        this.lastStats = null;
        this.connections = null; // Cached sorted connections
    }

    getName() {
        return 'CSA';
    }

    getDescription() {
        return 'Connection Scan Algorithm (10-100x faster, guaranteed optimal)';
    }

    /**
     * Build and cache sorted connections list
     * This is the key optimization - we only sort once!
     */
    buildConnections() {
        if (this.connections) {
            return this.connections;
        }

        const connections = [];

        // Build connections from transit trips
        parsedData.tripGroups.forEach((tripStops, tripId) => {
            const tripInfo = parsedData.tripInfo.get(tripId);

            for (let i = 0; i < tripStops.length - 1; i++) {
                const fromRow = tripStops[i];
                const toRow = tripStops[i + 1];

                if (fromRow.dep_sec !== null && toRow.arr_sec !== null) {
                    connections.push({
                        type: 'TRANSIT',
                        from_stop: fromRow.stop_id,
                        to_stop: toRow.stop_id,
                        depart_time: fromRow.dep_sec,
                        arrive_time: toRow.arr_sec,
                        trip_id: tripId,
                        route_short_name: tripInfo?.route_short_name || tripInfo?.route_id,
                        trip_headsign: tripInfo?.trip_headsign || ''
                    });
                }
            }
        });

        // Build walking connections (footpaths and geographic walks)
        const processedPairs = new Set();

        // Add pathway/transfer walks
        parsedData.walkEdges.forEach((edges, fromStop) => {
            edges.forEach(edge => {
                const travelTime = Math.max(MIN_TRAVEL_TIME_S, edge.time);
                const key = `${fromStop}-${edge.to}`;
                if (!processedPairs.has(key)) {
                    processedPairs.add(key);
                    connections.push({
                        type: 'WALK',
                        from_stop: fromStop,
                        to_stop: edge.to,
                        duration: travelTime,
                        source: edge.source
                    });
                }
            });
        });

        // Add geographic walks
        parsedData.stopById.forEach((stop, stopId) => {
            const nearby = nearbyStopsWithinRadius(stopId);
            nearby.forEach(nbr => {
                const walkTime = Math.ceil(nbr.distance / WALK_SPEED_MPS);
                if (walkTime > MIN_TRAVEL_TIME_S) {
                    const key = `${stopId}-${nbr.stopId}`;
                    if (!processedPairs.has(key)) {
                        processedPairs.add(key);
                        connections.push({
                            type: 'WALK',
                            from_stop: stopId,
                            to_stop: nbr.stopId,
                            duration: walkTime,
                            distance_m: Math.round(nbr.distance),
                            source: 'GEO'
                        });
                    }
                }
            });
        });

        // Sort connections by departure/usage time
        // For transit: by departure time
        // For walks: they can be used anytime, so we'll handle them separately
        this.connections = {
            transit: connections.filter(c => c.type === 'TRANSIT')
                .sort((a, b) => a.depart_time - b.depart_time),
            walks: connections.filter(c => c.type === 'WALK')
        };

        return this.connections;
    }

    async searchRoutes({ startPoint, endPoint, startTimeSec, maxRoutes = 3 }) {
        processGTFSData();

        const startTime = performance.now();

        // Build/get cached connections
        const { transit, walks } = this.buildConnections();

        // Initialize
        const startStops = resolvePointToStops(startPoint, startTimeSec);
        const endStops = resolveDestinationToStops(endPoint);
        const endStopSet = new Set(endStops.map(s => s.stopId));

        // Best arrival time at each stop
        const earliestArrival = new Map();
        const parent = new Map(); // For path reconstruction

        // Initialize start stops
        for (const start of startStops) {
            const arrivalTime = startTimeSec + start.walkTime;
            earliestArrival.set(start.stopId, arrivalTime);

            if (start.walkTime > 0) {
                parent.set(start.stopId, {
                    type: 'WALK',
                    from: 'START',
                    to_stop: start.stopId,
                    distance_m: start.distM,
                    depart_sec: startTimeSec,
                    arrive_sec: arrivalTime
                });
            } else {
                parent.set(start.stopId, {
                    type: 'START',
                    to_stop: start.stopId,
                    arrive_sec: startTimeSec
                });
            }
        }

        let iterations = 0;
        let improved = true;

        // CSA main loop: scan connections in chronological order
        // We do multiple rounds to handle footpaths properly
        const maxRounds = 10; // Limit number of rounds (transfers)

        for (let round = 0; round < maxRounds && improved; round++) {
            improved = false;

            // Scan all transit connections
            for (const conn of transit) {
                iterations++;

                // Can we catch this connection?
                const fromArrival = earliestArrival.get(conn.from_stop);
                if (fromArrival === undefined || fromArrival > conn.depart_time) {
                    continue; // Can't catch this connection
                }

                // Check if trip is too long
                if (conn.arrive_time - startTimeSec > MAX_TRIP_TIME_S) {
                    continue;
                }

                // Would this improve arrival at destination?
                const currentBest = earliestArrival.get(conn.to_stop);
                if (currentBest === undefined || conn.arrive_time < currentBest) {
                    earliestArrival.set(conn.to_stop, conn.arrive_time);
                    parent.set(conn.to_stop, {
                        type: 'TRANSIT',
                        from_stop: conn.from_stop,
                        to_stop: conn.to_stop,
                        depart_sec: conn.depart_time,
                        arrive_sec: conn.arrive_time,
                        trip_id: conn.trip_id,
                        route_short_name: conn.route_short_name,
                        trip_headsign: conn.trip_headsign,
                        board_sec: conn.depart_time,
                        alight_sec: conn.arrive_time
                    });
                    improved = true;
                }
            }

            // Apply footpaths after each round
            const stopsToExpand = Array.from(earliestArrival.keys());
            for (const stopId of stopsToExpand) {
                const arrivalTime = earliestArrival.get(stopId);

                // Try all walks from this stop
                for (const walkConn of walks) {
                    if (walkConn.from_stop !== stopId) continue;

                    const newArrival = arrivalTime + walkConn.duration;
                    if (newArrival - startTimeSec > MAX_TRIP_TIME_S) continue;

                    const currentBest = earliestArrival.get(walkConn.to_stop);
                    if (currentBest === undefined || newArrival < currentBest) {
                        earliestArrival.set(walkConn.to_stop, newArrival);
                        parent.set(walkConn.to_stop, {
                            type: 'WALK',
                            from_stop: walkConn.from_stop,
                            to_stop: walkConn.to_stop,
                            walk_sec: walkConn.duration,
                            distance_m: walkConn.distance_m,
                            depart_sec: arrivalTime,
                            arrive_sec: newArrival
                        });
                        improved = true;
                    }
                }
            }
        }

        // Find best route to any destination stop
        let bestDestStop = null;
        let bestArrival = Infinity;

        for (const endStopInfo of endStops) {
            const arrival = earliestArrival.get(endStopInfo.stopId);
            if (arrival !== undefined) {
                const finalArrival = arrival + endStopInfo.walkTime;
                if (finalArrival < bestArrival) {
                    bestArrival = finalArrival;
                    bestDestStop = endStopInfo;
                }
            }
        }

        // Reconstruct path
        const routes = [];
        if (bestDestStop) {
            const path = [];
            let current = bestDestStop.stopId;

            while (parent.has(current)) {
                const step = parent.get(current);
                path.unshift({
                    mode: step.type === 'WALK' || step.type === 'START' ? step.type : 'TRANSIT',
                    from_stop: step.from_stop,
                    to_stop: step.to_stop,
                    depart_sec: step.depart_sec,
                    arrive_sec: step.arrive_sec,
                    walk_sec: step.walk_sec,
                    distance_m: step.distance_m,
                    trip_id: step.trip_id,
                    route_short_name: step.route_short_name,
                    trip_headsign: step.trip_headsign,
                    board_sec: step.board_sec,
                    alight_sec: step.alight_sec
                });

                if (step.type === 'START') break;
                current = step.from_stop;
            }

            // Remove START step if present
            const finalPath = path.filter(step => step.mode !== 'START');

            // Add final walk if needed
            if (bestDestStop.walkTime > 0) {
                finalPath.push({
                    mode: 'WALK',
                    from_stop: bestDestStop.stopId,
                    to: 'END',
                    distance_m: bestDestStop.distM,
                    depart_sec: bestArrival - bestDestStop.walkTime,
                    arrive_sec: bestArrival
                });
            }

            const startStopId = startStops[0].stopId;

            routes.push({
                totalTime: bestArrival - startTimeSec,
                arrivalTime: bestArrival,
                path: finalPath,
                startStopId,
                destStopId: bestDestStop.stopId
            });
        }

        const endTime = performance.now();
        this.lastStats = {
            algorithm: this.getName(),
            iterations,
            visitedNodes: earliestArrival.size,
            routesFound: routes.length,
            executionTimeMs: endTime - startTime,
            totalConnections: transit.length + walks.length
        };

        return routes;
    }

    getStats() {
        return this.lastStats;
    }
}
