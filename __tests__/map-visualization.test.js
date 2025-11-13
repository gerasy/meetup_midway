const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

class MockElement {
    constructor(id = '') {
        this.id = id;
        this.innerHTML = '';
        this.textContent = '';
        this.className = '';
    }
}

class DocumentMock {
    constructor() {
        this.elements = new Map();
    }

    getElementById(id) {
        if (!this.elements.has(id)) {
            this.elements.set(id, new MockElement(id));
        }
        return this.elements.get(id);
    }

    createElement() {
        return new MockElement();
    }
}

global.window = { __MEETING_FINDER_SKIP_AUTORUN__: true };
global.document = new DocumentMock();

const meetingFinder = require('../meeting-finder.js');

function createSpy(impl = () => {}) {
    const fn = (...args) => {
        fn.calls.push(args);
        return impl(...args);
    };
    fn.calls = [];
    fn.callCount = () => fn.calls.length;
    return fn;
}

function createLayerSpy() {
    const layer = {};
    layer.bindPopup = createSpy(() => layer);
    layer.addTo = createSpy(target => {
        if (target && typeof target.addLayer === 'function') {
            target.addLayer(layer);
        }
        return layer;
    });
    layer.openPopup = createSpy(() => undefined);
    return layer;
}

beforeEach(() => {
    // Reset DOM elements
    document.elements.clear();
    document.getElementById('status');
    document.getElementById('results');

    // Clear parsed data maps used in the test
    meetingFinder.parsedData.stopById.clear();
    meetingFinder.parsedData.stopIdToStationId.clear();
    meetingFinder.parsedData.stationToName.clear();
    meetingFinder.parsedData.routeInfo.clear();

    meetingFinder.__setMapStateForTest({
        mapInstance: null,
        mapRouteLayer: null,
        mapMarkerLayer: null,
        mapLegendElement: null,
        mapLegendControl: null
    });
});

afterEach(() => {
    meetingFinder.__setMapStateForTest({
        mapInstance: null,
        mapRouteLayer: null,
        mapMarkerLayer: null,
        mapLegendElement: null,
        mapLegendControl: null
    });
    delete global.L;
});

test('renders map layers and legend entries when meeting is found', async () => {
    const markerAddLayer = createSpy();
    const markerClearLayers = createSpy();
    const routeAddLayer = createSpy();
    const routeClearLayers = createSpy();

    const legendElement = new MockElement('legend');

    const mapInstance = {
        fitBounds: createSpy(() => undefined),
        invalidateSize: createSpy(() => undefined)
    };

    const mapMarkerLayer = {
        addLayer: markerAddLayer,
        clearLayers: markerClearLayers
    };

    const mapRouteLayer = {
        addLayer: routeAddLayer,
        clearLayers: routeClearLayers
    };

    meetingFinder.__setMapStateForTest({
        mapInstance,
        mapMarkerLayer,
        mapRouteLayer,
        mapLegendElement: legendElement
    });

    const boundsObject = { bounds: true };

    global.L = {
        circleMarker: createSpy(() => createLayerSpy()),
        marker: createSpy(() => createLayerSpy()),
        polyline: createSpy(() => ({ type: 'polyline' })),
        latLngBounds: createSpy(() => boundsObject)
    };

    meetingFinder.parsedData.stopById.set('STOP_A', {
        stop_id: 'STOP_A',
        stop_lat: '52.5200',
        stop_lon: '13.4050',
        stop_name: 'Stop A'
    });
    meetingFinder.parsedData.stopById.set('STOP_B', {
        stop_id: 'STOP_B',
        stop_lat: '52.5210',
        stop_lon: '13.4060',
        stop_name: 'Stop B'
    });
    meetingFinder.parsedData.stopById.set('STOP_C', {
        stop_id: 'STOP_C',
        stop_lat: '52.5220',
        stop_lon: '13.4070',
        stop_name: 'Stop C'
    });

    meetingFinder.parsedData.stopIdToStationId.set('STOP_A', 'STA_A');
    meetingFinder.parsedData.stopIdToStationId.set('STOP_B', 'STA_B');
    meetingFinder.parsedData.stopIdToStationId.set('STOP_C', 'STA_C');

    meetingFinder.parsedData.stationToName.set('STA_A', 'Station A');
    meetingFinder.parsedData.stationToName.set('STA_B', 'Station B');
    meetingFinder.parsedData.stationToName.set('STA_C', 'Station C');

    meetingFinder.parsedData.routeInfo.set('ROUTE_1', {
        route_short_name: 'M1',
        route_long_name: 'Metro 1',
        route_type: '3',
        agency_id: 'agency'
    });

    const persons = [
        {
            label: 'A',
            startStopId: 'STOP_A',
            t0: 3600,
            reachedStopFirst: new Map([
                ['STOP_C', { arrTime: 4200, elapsed: 600 }]
            ]),
            parent: new Map([
                ['STOP_C', {
                    prevStop: 'STOP_B',
                    info: {
                        mode: 'WALK',
                        source: 'GEO',
                        from_stop: 'STOP_B',
                        to_stop: 'STOP_C',
                        walk_sec: 300,
                        depart_sec: 3900,
                        arrive_sec: 4200,
                        distance_m: 200
                    }
                }],
                ['STOP_B', {
                    prevStop: 'STOP_A',
                    info: {
                        mode: 'RIDE',
                        from_stop: 'STOP_A',
                        to_stop: 'STOP_B',
                        depart_sec: 3600,
                        arrive_sec: 3900,
                        wait_sec: 60,
                        ride_sec: 240,
                        route_id: 'ROUTE_1',
                        headsign: 'Downtown'
                    }
                }]
            ])
        }
    ];

    meetingFinder.displayResults({ type: 'OK', stopId: 'STOP_C' }, persons, '10:00:00');

    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(markerClearLayers.callCount() > 0, true, 'marker layer cleared');
    assert.equal(routeClearLayers.callCount() > 0, true, 'route layer cleared');
    assert.equal(markerAddLayer.callCount(), 2, 'two markers added (start + meeting)');
    assert.equal(routeAddLayer.callCount(), 2, 'two route segments added');
    assert.equal(global.L.polyline.callCount() > 0, true, 'polylines created');
    assert.equal(global.L.latLngBounds.callCount() > 0, true, 'bounds calculated');
    assert.deepEqual(mapInstance.fitBounds.calls[0], [boundsObject, { padding: [40, 40] }]);
    assert.deepEqual(mapInstance.invalidateSize.calls[0], [true]);

    const resultsHtml = document.getElementById('results').innerHTML;
    assert.ok(resultsHtml.includes('Meeting Point Found!'));
    assert.ok(resultsHtml.includes('Person A'));
    assert.ok(resultsHtml.includes('Route'));

    assert.ok(legendElement.innerHTML.includes('Person A'));
    assert.ok(legendElement.innerHTML.includes('Routes'));

    assert.equal(document.getElementById('status').textContent, 'Meeting point found successfully!');
});
