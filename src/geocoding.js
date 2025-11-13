import { parsedData } from './state.js';
import { haversineM } from './geometry.js';

// Nominatim (OpenStreetMap) geocoding service
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// Rate limiting: Nominatim requires max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;

async function rateLimitedFetch(url) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }

    lastRequestTime = Date.now();
    return fetch(url);
}

export async function searchAddress(query) {
    if (!query || query.trim().length < 3) {
        return [];
    }

    try {
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            addressdetails: '1',
            limit: '10',
            countrycodes: 'de',
            bounded: '1',
            viewbox: '13.0882097323,52.6755087652,13.7611609349,52.3382448694' // Berlin bounding box
        });

        const response = await rateLimitedFetch(`${NOMINATIM_ENDPOINT}?${params}`);

        if (!response.ok) {
            console.error('Nominatim API error:', response.status);
            return [];
        }

        const results = await response.json();

        return results.map(result => ({
            displayName: result.display_name,
            lat: parseFloat(result.lat),
            lon: parseFloat(result.lon),
            type: result.type,
            address: result.address,
            osmType: result.osm_type,
            osmId: result.osm_id
        }));
    } catch (error) {
        console.error('Error searching address:', error);
        return [];
    }
}

export function findNearestStation(lat, lon, maxDistanceM = 1000) {
    let nearestStation = null;
    let minDistance = maxDistanceM;

    // Group all stops by station
    const stations = new Map();

    parsedData.stopIdToStationId.forEach((stationId, stopId) => {
        if (!stations.has(stationId)) {
            stations.set(stationId, {
                stationId,
                name: parsedData.stationToName.get(stationId),
                stops: []
            });
        }
        stations.get(stationId).stops.push(stopId);
    });

    // Find nearest station
    stations.forEach(station => {
        // Use the first stop of the station to calculate distance
        const firstStopId = station.stops[0];
        const stop = parsedData.stopById.get(firstStopId);

        if (stop) {
            const stopLat = parseFloat(stop.stop_lat);
            const stopLon = parseFloat(stop.stop_lon);

            if (!isNaN(stopLat) && !isNaN(stopLon)) {
                const distance = haversineM(lat, lon, stopLat, stopLon);

                if (distance < minDistance) {
                    minDistance = distance;
                    nearestStation = {
                        stationId: station.stationId,
                        name: station.name,
                        distance: distance,
                        stopId: firstStopId
                    };
                }
            }
        }
    });

    return nearestStation;
}

export function formatStationWithDistance(stationName, distanceM) {
    if (distanceM < 1000) {
        return `${stationName} (${Math.round(distanceM)}m away)`;
    } else {
        return `${stationName} (${(distanceM / 1000).toFixed(1)}km away)`;
    }
}
