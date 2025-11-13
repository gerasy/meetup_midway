import { DLAT, DLON } from './constants.js';

export function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000.0;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180;
    const dlambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

export function cellFor(lat, lon) {
    return `${Math.floor(lat / DLAT)},${Math.floor(lon / DLON)}`;
}

export function calculateGeographicMidpoint(coordinates) {
    if (!coordinates || coordinates.length === 0) {
        return null;
    }

    if (coordinates.length === 1) {
        return { lat: coordinates[0].lat, lon: coordinates[0].lon };
    }

    // Convert to Cartesian coordinates
    let x = 0, y = 0, z = 0;

    for (const coord of coordinates) {
        const latRad = coord.lat * Math.PI / 180;
        const lonRad = coord.lon * Math.PI / 180;

        x += Math.cos(latRad) * Math.cos(lonRad);
        y += Math.cos(latRad) * Math.sin(lonRad);
        z += Math.sin(latRad);
    }

    const total = coordinates.length;
    x /= total;
    y /= total;
    z /= total;

    // Convert back to latitude/longitude
    const lonRad = Math.atan2(y, x);
    const hyp = Math.sqrt(x * x + y * y);
    const latRad = Math.atan2(z, hyp);

    return {
        lat: latRad * 180 / Math.PI,
        lon: lonRad * 180 / Math.PI
    };
}
