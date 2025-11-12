import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineM, cellFor } from '../src/geometry.js';
import { DLAT, DLON } from '../src/constants.js';

test('haversineM returns near zero for identical points', () => {
    assert.ok(haversineM(52.5, 13.4, 52.5, 13.4) < 0.1);
});

test('haversineM approximates known distance', () => {
    const distance = haversineM(52.5, 13.4, 52.6, 13.4);
    assert.ok(Math.abs(distance - 11132) < 100);
});

test('cellFor buckets coordinates into grid keys', () => {
    assert.equal(cellFor(52.5, 13.4), `${Math.floor(52.5 / DLAT)},${Math.floor(13.4 / DLON)}`);
});
