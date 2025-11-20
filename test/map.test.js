import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRouteCoordinates } from '../src/map.js';
import { parsedData } from '../src/state.js';

test('computeRouteCoordinates assembles start, steps, and meeting stops', () => {
    parsedData.stopById.clear();
    parsedData.stopById.set('S1', { stop_lat: '52.5', stop_lon: '13.4' });
    parsedData.stopById.set('S2', { stop_lat: '52.6', stop_lon: '13.5' });
    parsedData.stopById.set('S3', { stop_lat: '52.7', stop_lon: '13.6' });

    const coords = computeRouteCoordinates('S1', [{ to_stop: 'S2' }], 'S3');
    assert.deepEqual(coords, [
        [52.5, 13.4],
        [52.6, 13.5],
        [52.7, 13.6]
    ]);
});

test('computeRouteCoordinates omits missing stops and avoids duplicates', () => {
    parsedData.stopById.clear();
    parsedData.stopById.set('S1', { stop_lat: '52.5', stop_lon: '13.4' });
    parsedData.stopById.set('S2', { stop_lat: '52.5', stop_lon: '13.4' });

    const coords = computeRouteCoordinates('S1', [{ to_stop: 'S2' }], 'S2');
    assert.deepEqual(coords, [[52.5, 13.4]]);
});

test('computeRouteCoordinates includes intermediate transit stops', () => {
    parsedData.stopById.clear();
    parsedData.tripGroups.clear();

    parsedData.stopById.set('A', { stop_lat: '52.50', stop_lon: '13.40' });
    parsedData.stopById.set('B', { stop_lat: '52.55', stop_lon: '13.45' });
    parsedData.stopById.set('C', { stop_lat: '52.60', stop_lon: '13.50' });
    parsedData.stopById.set('D', { stop_lat: '52.65', stop_lon: '13.55' });

    parsedData.tripGroups.set('T1', [
        { stop_id: 'A', stop_sequence: 1 },
        { stop_id: 'B', stop_sequence: 2 },
        { stop_id: 'C', stop_sequence: 3 },
        { stop_id: 'D', stop_sequence: 4 },
    ]);

    const coords = computeRouteCoordinates('A', [{
        mode: 'RIDE',
        trip_id: 'T1',
        from_stop: 'A',
        to_stop: 'D'
    }]);

    assert.deepEqual(coords, [
        [52.50, 13.40],
        [52.55, 13.45],
        [52.60, 13.50],
        [52.65, 13.55]
    ]);
});
