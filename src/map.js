import { parsedData } from './state.js';

const ROUTE_COLORS = ['#2563eb', '#ef4444', '#facc15', '#22c55e', '#a855f7'];
const MEETING_COLOR = '#a855f7';
const START_RADIUS = 9;
const STOP_DOT_RADIUS = 3;
const DEFAULT_CENTER = [52.52, 13.405]; // Berlin
const DEFAULT_ZOOM = 12;
const BERLIN_STOP_ID_PREFIX = 'de:11000:';

let mapInstance = null;
let baseLayer = null;
let stopLayer = null;
let routeLayer = null;
let startLayer = null;
let meetingLayer = null;

function ensureLeafletReady() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }
    if (typeof L === 'undefined') {
        console.warn('Leaflet is not loaded; map rendering skipped.');
        return false;
    }
    return true;
}

function getStopCoordinates(stopId) {
    if (!stopId) {
        return null;
    }
    const stop = parsedData.stopById.get(stopId);
    if (!stop) {
        return null;
    }
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return null;
    }
    return [lat, lon];
}

function createBaseMap(container) {
    if (mapInstance) {
        mapInstance.remove();
    }

    mapInstance = L.map(container, {
        zoomControl: true,
        preferCanvas: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance);

    stopLayer = L.layerGroup().addTo(mapInstance);
    routeLayer = L.layerGroup().addTo(mapInstance);
    startLayer = L.layerGroup().addTo(mapInstance);
    meetingLayer = L.layerGroup().addTo(mapInstance);
}

export function initializeMap() {
    if (!ensureLeafletReady()) {
        return;
    }

    const container = document.getElementById('map');
    if (!container) {
        return;
    }

    createBaseMap(container);
}

function coordsEqual(a, b) {
    return a && b && a[0] === b[0] && a[1] === b[1];
}

function stopsAlongTripSegment(step) {
    if (!step.trip_id || !step.from_stop || !step.to_stop) {
        return [step.to_stop].filter(Boolean);
    }

    const tripStops = parsedData.tripGroups.get(step.trip_id);
    if (!tripStops || tripStops.length === 0) {
        return [step.to_stop].filter(Boolean);
    }

    let fromIdx = -1;
    let toIdx = -1;

    for (let i = 0; i < tripStops.length; i += 1) {
        const st = tripStops[i];
        if (fromIdx === -1 && st.stop_id === step.from_stop) {
            fromIdx = i;
            continue;
        }
        if (fromIdx !== -1 && st.stop_id === step.to_stop) {
            toIdx = i;
            break;
        }
    }

    if (fromIdx === -1 || toIdx === -1 || toIdx <= fromIdx) {
        return [step.to_stop].filter(Boolean);
    }

    return tripStops
        .slice(fromIdx + 1, toIdx + 1)
        .map(st => st.stop_id)
        .filter(Boolean);
}

function stopsForStep(step) {
    if (!step) {
        return [];
    }

    if (step.mode === 'TRANSIT' || step.mode === 'RIDE') {
        return stopsAlongTripSegment(step);
    }

    return [step.to_stop].filter(Boolean);
}

export function computeRouteCoordinates(startStopId, steps, meetingStopId) {
    const coords = [];
    const startCoord = getStopCoordinates(startStopId);
    if (startCoord) {
        coords.push(startCoord);
    }

    for (const step of steps || []) {
        stopsForStep(step).forEach(stopId => {
            const destCoord = getStopCoordinates(stopId);
            if (destCoord && !coordsEqual(coords.at(-1), destCoord)) {
                coords.push(destCoord);
            }
        });
    }

    if (meetingStopId) {
        const meetCoord = getStopCoordinates(meetingStopId);
        if (meetCoord && !coordsEqual(coords.at(-1), meetCoord)) {
            coords.push(meetCoord);
        }
    }

    return coords;
}

function addStartMarker(point, color, label) {
    return L.circleMarker(point, {
        radius: START_RADIUS,
        color,
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
    }).bindPopup(`Start: ${label ?? 'Person'}`);
}

function addMeetingMarker(point) {
    return L.circleMarker(point, {
        radius: START_RADIUS,
        color: MEETING_COLOR,
        weight: 4,
        fillColor: '#ffffff',
        fillOpacity: 1,
    }).bindPopup('Meeting point');
}

export function showRoutesOnMap(meetingStopId, pathData) {
    if (!ensureLeafletReady() || !mapInstance) {
        return;
    }

    routeLayer.clearLayers();
    startLayer.clearLayers();
    meetingLayer.clearLayers();

    const bounds = [];

    (pathData || []).forEach((entry, index) => {
        const coords = computeRouteCoordinates(entry.startStopId, entry.steps, meetingStopId)
            .map(([lat, lon]) => ({ lat, lng: lon }))
            .filter(pt => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));

        if (coords.length === 0) {
            return;
        }

        const color = ROUTE_COLORS[index % ROUTE_COLORS.length];

        const polyline = L.polyline(coords, {
            color,
            weight: 4,
            opacity: 0.9,
        });

        polyline.addTo(routeLayer);
        bounds.push(...coords);

        const startMarker = addStartMarker(coords[0], color, entry.label);
        startMarker.addTo(startLayer);
    });

    if (meetingStopId) {
        const meetingCoords = getStopCoordinates(meetingStopId);
        if (meetingCoords) {
            const meetingPoint = { lat: meetingCoords[0], lng: meetingCoords[1] };
            bounds.push(meetingPoint);
            addMeetingMarker(meetingPoint).addTo(meetingLayer);
        }
    }

    if (bounds.length > 0) {
        mapInstance.fitBounds(bounds, { padding: [30, 30] });
    }
}

export function resetMap() {
    if (!mapInstance) {
        return;
    }
    routeLayer.clearLayers();
    startLayer.clearLayers();
    meetingLayer.clearLayers();
    mapInstance.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
}

export function updateAllStationsOnMap() {
    if (!ensureLeafletReady() || !mapInstance) {
        return;
    }

    stopLayer.clearLayers();

    const seen = new Set();
    const dots = [];

    parsedData.stopById.forEach(stop => {
        const stopId = typeof stop.stop_id === 'string' ? stop.stop_id : '';
        if (!stopId.startsWith(BERLIN_STOP_ID_PREFIX)) {
            return;
        }
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
        }
        const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        dots.push([lat, lon]);
    });

    dots.forEach(([lat, lon]) => {
        L.circleMarker({ lat, lng: lon }, {
            radius: STOP_DOT_RADIUS,
            color: '#16a34a',
            weight: 0,
            fillColor: '#22c55e',
            fillOpacity: 0.5,
        }).addTo(stopLayer);
    });

    if (dots.length > 0) {
        mapInstance.fitBounds(dots.map(([lat, lon]) => ({ lat, lng: lon })), { padding: [30, 30] });
    }
}
