import { parsedData } from './state.js';

const ROUTE_COLORS = ['#2563eb', '#ef4444', '#facc15', '#22c55e', '#a855f7'];
const BACKGROUND_COLOR = '#020617';
const BORDER_FILL = '#0b1530';
const BORDER_STROKE = '#1f2a44';
const STOP_COLOR = '#1f2937';
const ROUTE_STOP_COLOR = '#000000';
const MEETING_COLOR = '#a855f7';
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const WHEEL_ZOOM_FACTOR = 1.12;

// BVG Berlin stops have IDs beginning with this prefix. When drawing the
// background constellation of stations we restrict ourselves to these stops so
// that the map reflects the Berlin area instead of the entire VBB region
// present in the GTFS subset.
const BERLIN_STOP_ID_PREFIX = 'de:11000:';

let canvas = null;
let ctx = null;
let viewWidth = 0;
let viewHeight = 0;
let pixelRatio = 1;

let zoom = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;
let panStartY = 0;
let hasUserInteracted = false;

let boundaryLonLat = [];
let boundaryWorld = [];
let stopLonLat = [];
let stopWorld = [];
let routeData = [];
let routeWorld = [];
let meetingLatLon = null;
let meetingWorld = null;

let minLon = null;
let maxLon = null;
let minLat = null;
let maxLat = null;
let scale = 1;
let offsetX = 0;
let offsetY = 0;

function recalcBounds() {
    let minLonVal = Infinity;
    let maxLonVal = -Infinity;
    let minLatVal = Infinity;
    let maxLatVal = -Infinity;

    const updateExtents = ({ lon, lat }) => {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            return;
        }
        if (lon < minLonVal) minLonVal = lon;
        if (lon > maxLonVal) maxLonVal = lon;
        if (lat < minLatVal) minLatVal = lat;
        if (lat > maxLatVal) maxLatVal = lat;
    };

    boundaryLonLat.forEach(ring => ring.forEach(updateExtents));
    stopLonLat.forEach(updateExtents);

    if (!Number.isFinite(minLonVal) || !Number.isFinite(minLatVal) || !Number.isFinite(maxLonVal) || !Number.isFinite(maxLatVal)) {
        minLon = maxLon = minLat = maxLat = null;
        return;
    }

    const lonSpan = Math.max(maxLonVal - minLonVal, 1e-6);
    const latSpan = Math.max(maxLatVal - minLatVal, 1e-6);

    const lonPad = Math.max(lonSpan * 0.05, 0.01);
    const latPad = Math.max(latSpan * 0.05, 0.01);

    minLon = minLonVal - lonPad;
    maxLon = maxLonVal + lonPad;
    minLat = minLatVal - latPad;
    maxLat = maxLatVal + latPad;
}

function projectToBase(lon, lat) {
    if (minLon === null || maxLon === null || minLat === null || maxLat === null) {
        return null;
    }
    return {
        x: (lon - minLon) * scale + offsetX,
        y: (maxLat - lat) * scale + offsetY
    };
}

function recomputeTransform(resetView = false) {
    if (!canvas || minLon === null || maxLon === null || minLat === null || maxLat === null) {
        return;
    }

    const lonSpan = Math.max(maxLon - minLon, 1e-6);
    const latSpan = Math.max(maxLat - minLat, 1e-6);
    const margin = 40;
    const availableWidth = Math.max(viewWidth - margin * 2, 10);
    const availableHeight = Math.max(viewHeight - margin * 2, 10);

    scale = Math.min(availableWidth / lonSpan, availableHeight / latSpan);
    offsetX = (viewWidth - lonSpan * scale) / 2;
    offsetY = (viewHeight - latSpan * scale) / 2;

    boundaryWorld = boundaryLonLat.map(ring => ring.map(pt => projectToBase(pt.lon, pt.lat)).filter(Boolean));
    stopWorld = stopLonLat.map(pt => projectToBase(pt.lon, pt.lat)).filter(Boolean);
    updateRouteWorld();

    if (resetView) {
        zoom = 1;
        panX = 0;
        panY = 0;
        hasUserInteracted = false;
    }
}

function worldToScreen(point) {
    const cx = viewWidth / 2;
    const cy = viewHeight / 2;
    return {
        x: (point.x - cx) * zoom + cx + panX,
        y: (point.y - cy) * zoom + cy + panY
    };
}

function drawPolygon(ring) {
    if (!ring || ring.length === 0) {
        return;
    }
    ctx.beginPath();
    ring.forEach((worldPoint, idx) => {
        const screen = worldToScreen(worldPoint);
        if (idx === 0) {
            ctx.moveTo(screen.x, screen.y);
        } else {
            ctx.lineTo(screen.x, screen.y);
        }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawStops() {
    if (!stopWorld.length) {
        return;
    }
    ctx.fillStyle = STOP_COLOR;
    const size = Math.min(3, Math.max(1.5, 2 * Math.pow(zoom, 0.15)));
    for (const worldPoint of stopWorld) {
        const screen = worldToScreen(worldPoint);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawRoutes() {
    routeWorld.forEach(route => {
        if (!route.world || route.world.length < 2) {
            return;
        }
        ctx.lineWidth = Math.max(4, 6 / Math.sqrt(zoom));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = route.color;
        ctx.beginPath();
        route.world.forEach((worldPoint, idx) => {
            const screen = worldToScreen(worldPoint);
            if (idx === 0) {
                ctx.moveTo(screen.x, screen.y);
            } else {
                ctx.lineTo(screen.x, screen.y);
            }
        });
        ctx.stroke();
    });

    if (routeWorld.length > 0) {
        ctx.fillStyle = ROUTE_STOP_COLOR;
        routeWorld.forEach(route => {
            route.world.forEach(worldPoint => {
                const screen = worldToScreen(worldPoint);
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, Math.max(2.5, 3.5 / Math.sqrt(zoom)), 0, Math.PI * 2);
                ctx.fill();
            });
        });
    }
}

function drawMeeting() {
    if (!meetingWorld) {
        return;
    }
    const screen = worldToScreen(meetingWorld);
    const size = 10;
    ctx.strokeStyle = MEETING_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screen.x - size, screen.y - size);
    ctx.lineTo(screen.x + size, screen.y + size);
    ctx.moveTo(screen.x + size, screen.y - size);
    ctx.lineTo(screen.x - size, screen.y + size);
    ctx.stroke();
}

function drawStartMarkers() {
    routeWorld.forEach(route => {
        if (!route.world || route.world.length === 0) {
            return;
        }
        const start = worldToScreen(route.world[0]);
        ctx.fillStyle = route.color;
        ctx.beginPath();
        ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = BACKGROUND_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

function draw() {
    if (!ctx || viewWidth === 0 || viewHeight === 0) {
        return;
    }

    ctx.clearRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.fillStyle = BORDER_FILL;
    ctx.strokeStyle = BORDER_STROKE;
    ctx.lineWidth = 2;
    boundaryWorld.forEach(drawPolygon);

    drawStops();
    drawRoutes();
    drawStartMarkers();
    drawMeeting();
}

function handleWheel(evt) {
    if (!canvas) {
        return;
    }
    const mouseX = evt.offsetX;
    const mouseY = evt.offsetY;
    const direction = evt.deltaY < 0 ? 1 : -1;
    const factor = direction > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const scaleRatio = newZoom / zoom;
    const deltaX = mouseX - (mouseX - panX) * scaleRatio;
    const deltaY = mouseY - (mouseY - panY) * scaleRatio;
    zoom = newZoom;
    panX = deltaX;
    panY = deltaY;
    hasUserInteracted = true;
    evt.preventDefault();
    draw();
}

function handleMouseDown(evt) {
    isDragging = true;
    dragStartX = evt.clientX;
    dragStartY = evt.clientY;
    panStartX = panX;
    panStartY = panY;
}

function handleMouseMove(evt) {
    if (!isDragging) {
        return;
    }
    const dx = evt.clientX - dragStartX;
    const dy = evt.clientY - dragStartY;
    panX = panStartX + dx;
    panY = panStartY + dy;
    hasUserInteracted = true;
    draw();
}

function handleMouseUp() {
    isDragging = false;
}

function resizeCanvas(resetView = false) {
    if (!canvas || !ctx) {
        return;
    }
    const rect = canvas.getBoundingClientRect();
    pixelRatio = window.devicePixelRatio || 1;
    viewWidth = rect.width;
    viewHeight = rect.height;
    canvas.width = rect.width * pixelRatio;
    canvas.height = rect.height * pixelRatio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    recomputeTransform(resetView);
    draw();
}

function updateRouteWorld() {
    routeWorld = routeData.map(route => ({
        color: route.color,
        world: route.coords
            .map(coord => projectToBase(coord.lon, coord.lat))
            .filter(Boolean)
    }));
    meetingWorld = meetingLatLon ? projectToBase(meetingLatLon.lon, meetingLatLon.lat) : null;
}

function focusOnWorldBounds(points) {
    if (!points.length || viewWidth === 0 || viewHeight === 0) {
        return;
    }
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 10);
    const spanY = Math.max(maxY - minY, 10);
    const margin = 80;
    const availableWidth = Math.max(viewWidth - margin, 50);
    const availableHeight = Math.max(viewHeight - margin, 50);
    const zoomX = availableWidth / spanX;
    const zoomY = availableHeight / spanY;
    const targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(zoomX, zoomY)));
    zoom = targetZoom;
    const cx = viewWidth / 2;
    const cy = viewHeight / 2;
    const worldCx = (minX + maxX) / 2;
    const worldCy = (minY + maxY) / 2;
    panX = (cx - worldCx) * zoom;
    panY = (cy - worldCy) * zoom;
    hasUserInteracted = false;
}

async function loadBoundary() {
    if (typeof fetch === 'undefined') {
        return;
    }
    try {
        const response = await fetch('berlin-boundary.geojson');
        if (!response.ok) {
            throw new Error(`Failed to load berlin-boundary.geojson (${response.status})`);
        }
        const geojson = await response.json();
        const rings = [];
        for (const feature of geojson.features || []) {
            const geometry = feature.geometry;
            if (!geometry) {
                continue;
            }
            if (geometry.type === 'Polygon') {
                if (Array.isArray(geometry.coordinates[0])) {
                    rings.push(geometry.coordinates[0]);
                }
            } else if (geometry.type === 'MultiPolygon') {
                geometry.coordinates.forEach(poly => {
                    if (Array.isArray(poly[0])) {
                        rings.push(poly[0]);
                    }
                });
            }
        }
        boundaryLonLat = rings.map(ring => ring.map(([lon, lat]) => ({ lon, lat })));
        recalcBounds();
        recomputeTransform(!hasUserInteracted && routeData.length === 0);
        draw();
    } catch (err) {
        console.error('Failed to load berlin-boundary.geojson', err);
    }
}

export function initializeMap() {
    if (typeof document === 'undefined') {
        return;
    }
    const canvasEl = document.getElementById('mapCanvas');
    if (!canvasEl) {
        return;
    }
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('resize', () => resizeCanvas(!hasUserInteracted && routeData.length === 0));
    resizeCanvas(true);
    loadBoundary();
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

export function showRoutesOnMap(meetingStopId, pathData) {
    const paths = [];
    (pathData || []).forEach((entry, index) => {
        const coords = computeRouteCoordinates(entry.startStopId, entry.steps, meetingStopId)
            .map(([lat, lon]) => ({ lat, lon }))
            .filter(pt => Number.isFinite(pt.lat) && Number.isFinite(pt.lon));
        if (coords.length === 0) {
            return;
        }
        const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
        paths.push({ color, coords });
    });

    routeData = paths;
    meetingLatLon = null;
    if (meetingStopId) {
        const meetCoord = getStopCoordinates(meetingStopId);
        if (meetCoord) {
            meetingLatLon = { lat: meetCoord[0], lon: meetCoord[1] };
        }
    }

    updateRouteWorld();

    const focusPoints = [];
    routeWorld.forEach(route => {
        route.world.forEach(pt => focusPoints.push(pt));
    });
    if (meetingWorld) {
        focusPoints.push(meetingWorld);
    }
    if (focusPoints.length > 0) {
        focusOnWorldBounds(focusPoints);
    }

    draw();
}

export function resetMap() {
    routeData = [];
    routeWorld = [];
    meetingLatLon = null;
    meetingWorld = null;
    zoom = 1;
    panX = 0;
    panY = 0;
    hasUserInteracted = false;
    draw();
}

export function updateAllStationsOnMap() {
    const seen = new Set();
    const points = [];
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
        points.push({ lat, lon });
    });
    stopLonLat = points.map(pt => ({ lon: pt.lon, lat: pt.lat }));
    recalcBounds();
    recomputeTransform(!hasUserInteracted && routeData.length === 0);
    draw();
}
