import { parsedData } from './state.js';

const ROUTE_COLORS = ['#f97316', '#22d3ee', '#a855f7', '#4ade80', '#facc15'];

let mapInstance = null;
let overlayLayers = [];
let tileLayerAttached = false;

function ensureMap() {
    if (typeof window === 'undefined' || !window.L) {
        return null;
    }

    if (mapInstance) {
        return mapInstance;
    }

    const container = document.getElementById('map');
    if (!container) {
        return null;
    }

    mapInstance = window.L.map(container, {
        preferCanvas: true
    }).setView([52.52, 13.405], 12);

    if (!tileLayerAttached) {
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(mapInstance);
        tileLayerAttached = true;
    }

    return mapInstance;
}

export function initializeMap() {
    const map = ensureMap();
    if (map) {
        window.requestAnimationFrame(() => {
            map.invalidateSize();
        });
    }
}

function removeOverlayLayers() {
    if (!mapInstance) {
        overlayLayers = [];
        return;
    }

    overlayLayers.forEach(layer => {
        if (mapInstance.hasLayer(layer)) {
            mapInstance.removeLayer(layer);
        }
    });
    overlayLayers = [];
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

function coordsEqual(a, b) {
    return a && b && a[0] === b[0] && a[1] === b[1];
}

export function computeRouteCoordinates(startStopId, steps, meetingStopId) {
    const coords = [];
    const startCoord = getStopCoordinates(startStopId);
    if (startCoord) {
        coords.push(startCoord);
    }

    for (const step of steps || []) {
        const destCoord = getStopCoordinates(step.to_stop);
        if (destCoord && !coordsEqual(coords[coords.length - 1], destCoord)) {
            coords.push(destCoord);
        }
    }

    if (meetingStopId) {
        const meetCoord = getStopCoordinates(meetingStopId);
        if (meetCoord && !coordsEqual(coords[coords.length - 1], meetCoord)) {
            coords.push(meetCoord);
        }
    }

    return coords;
}

function addStartMarker(map, coord, label, color) {
    if (!coord) {
        return null;
    }
    return window.L.circleMarker(coord, {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2
    }).bindPopup(`Start - Person ${label}`)
        .addTo(map);
}

function addMeetingMarker(map, coord) {
    if (!coord) {
        return null;
    }
    return window.L.marker(coord, {
        title: 'Meeting Point'
    }).bindPopup('Meeting Point')
        .addTo(map);
}

export function showRoutesOnMap(meetingStopId, pathData) {
    const map = ensureMap();
    if (!map) {
        return;
    }

    map.invalidateSize();
    removeOverlayLayers();

    const bounds = window.L.latLngBounds([]);
    const extendBounds = (latlng) => {
        if (!latlng) {
            return;
        }
        if (!bounds.isValid()) {
            bounds.extend(latlng);
        } else {
            bounds.extend(latlng);
        }
    };

    (pathData || []).forEach((entry, index) => {
        const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
        const coords = computeRouteCoordinates(entry.startStopId, entry.steps, meetingStopId);

        const startCoord = getStopCoordinates(entry.startStopId);
        if (startCoord) {
            const startMarker = addStartMarker(map, startCoord, entry.label, color);
            if (startMarker) {
                overlayLayers.push(startMarker);
                extendBounds(startMarker.getLatLng());
            }
        }

        if (coords.length >= 2) {
            const line = window.L.polyline(coords, {
                color,
                weight: 5,
                opacity: 0.85
            }).addTo(map);
            overlayLayers.push(line);
            line.getLatLngs().forEach(extendBounds);
        }
    });

    const meetingCoord = getStopCoordinates(meetingStopId);
    if (meetingCoord) {
        const marker = addMeetingMarker(map, meetingCoord);
        if (marker) {
            overlayLayers.push(marker);
            extendBounds(marker.getLatLng());
        }
    }

    if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.15));
    }
}

export function resetMap() {
    if (!mapInstance) {
        return;
    }
    removeOverlayLayers();
}
