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
