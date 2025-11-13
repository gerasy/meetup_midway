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
