import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSVLine, parseCSV, toSeconds, sec2hm, formatMinutes } from '../src/parsing.js';

test('parseCSVLine handles quoted commas', () => {
    const line = 'stop_id,"Complex, Station",52.5';
    assert.deepEqual(parseCSVLine(line), ['stop_id', 'Complex, Station', '52.5']);
});

test('parseCSV converts rows into objects', () => {
    const csv = 'col1,col2\n1,hello\n2,world';
    assert.deepEqual(parseCSV(csv), [
        { col1: '1', col2: 'hello' },
        { col1: '2', col2: 'world' }
    ]);
});

test('toSeconds parses HH:MM:SS', () => {
    assert.equal(toSeconds('02:30:15'), 9015);
    assert.equal(toSeconds(''), null);
    assert.equal(toSeconds('bad'), null);
});

test('sec2hm formats zero padded hours and minutes', () => {
    assert.equal(sec2hm(0), '00:00');
    assert.equal(sec2hm(3660), '01:01');
});

test('formatMinutes prints integers and decimals appropriately', () => {
    assert.equal(formatMinutes(600), '10 min');
    assert.equal(formatMinutes(650), '10.8 min');
});
