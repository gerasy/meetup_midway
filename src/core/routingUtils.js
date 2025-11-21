import { parsedData } from '../state.js';
import { resolveStation, pickStartPlatform } from '../gtfsProcessing.js';
import { haversineM } from '../geometry.js';
import { WALK_SPEED_MPS } from '../constants.js';

/**
 * Get nearby transit stops within walking distance of a point
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} maxDistanceM - Maximum walking distance in meters
 * @returns {Array} Array of {stopId, walkTime, distM}
 */
export function getNearbyTransitStops(lat, lon, maxDistanceM) {
    const stops = [];

    parsedData.stopById.forEach((stop, stopId) => {
        const stopLat = parseFloat(stop.stop_lat);
        const stopLon = parseFloat(stop.stop_lon);

        if (!isNaN(stopLat) && !isNaN(stopLon)) {
            const distM = haversineM(lat, lon, stopLat, stopLon);

            if (distM <= maxDistanceM) {
                const walkTime = Math.ceil(distM / WALK_SPEED_MPS);
                stops.push({ stopId, walkTime, distM });
            }
        }
    });

    return stops;
}

/**
 * Resolve a point (address or station name) to stop IDs
 * @param {Object} point - Point object {query, isAddress, lat, lon}
 * @param {number} startTimeSec - Start time for platform selection
 * @param {number} maxWalkDistM - Maximum walking distance for addresses
 * @returns {Array} Array of {stopId, walkTime, distM}
 */
export function resolvePointToStops(point, startTimeSec, maxWalkDistM = 1000) {
    if (point.isAddress) {
        // Find nearby transit stops
        const stops = getNearbyTransitStops(point.lat, point.lon, maxWalkDistM);

        if (stops.length === 0) {
            throw new Error(`No transit stops found within ${maxWalkDistM}m of address`);
        }

        return stops;
    } else {
        // It's a station name - resolve to stop IDs
        const resolved = resolveStation(point.query);
        const chosenStart = pickStartPlatform(resolved.stationId, startTimeSec);
        return [{ stopId: chosenStart, walkTime: 0, distM: 0 }];
    }
}

/**
 * Get all platform IDs for a destination station
 * @param {Object} point - Point object {query, isAddress, lat, lon}
 * @param {number} maxWalkDistM - Maximum walking distance for addresses
 * @returns {Array} Array of {stopId, walkTime, distM}
 */
export function resolveDestinationToStops(point, maxWalkDistM = 1000) {
    if (point.isAddress) {
        // Find nearby transit stops
        const stops = getNearbyTransitStops(point.lat, point.lon, maxWalkDistM);

        if (stops.length === 0) {
            throw new Error(`No transit stops found within ${maxWalkDistM}m of destination`);
        }

        return stops;
    } else {
        // It's a station name - get all platforms
        const resolved = resolveStation(point.query);
        const allPlatforms = [];

        parsedData.stopIdToStationId.forEach((stationId, stopId) => {
            if (stationId === resolved.stationId) {
                allPlatforms.push(stopId);
            }
        });

        return allPlatforms.map(stopId => ({ stopId, walkTime: 0, distM: 0 }));
    }
}

/**
 * Get the name of a stop
 * @param {string} stopId - Stop ID
 * @returns {string} Stop name
 */
export function getStopName(stopId) {
    const stop = parsedData.stopById.get(stopId);
    return stop ? stop.stop_name : stopId;
}

/**
 * Format duration in seconds to readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
export function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}min`;
}
