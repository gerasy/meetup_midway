import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePeopleInputs } from '../src/search.js';
import { MAX_PARTICIPANTS } from '../src/constants.js';

test('validatePeopleInputs rejects when fewer than two participants are provided', () => {
    const result = validatePeopleInputs([{ label: 'A', query: 'Alexanderplatz' }]);
    assert.equal(result.ok, false);
    assert.match(result.error, /at least two/i);
});

test('validatePeopleInputs rejects empty station queries', () => {
    const result = validatePeopleInputs([
        { label: 'A', query: 'Alexanderplatz' },
        { label: 'B', query: '' }
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /Person B/i);
});

test('validatePeopleInputs enforces maximum participants', () => {
    const tooMany = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, idx) => ({
        label: String.fromCharCode(65 + idx),
        query: `Station ${idx}`
    }));

    const result = validatePeopleInputs(tooMany);
    assert.equal(result.ok, false);
    assert.match(result.error, /maximum/i);
});

test('validatePeopleInputs passes for valid inputs', () => {
    const inputs = [
        { label: 'A', query: 'Alexanderplatz' },
        { label: 'B', query: 'U Spittelmarkt' },
        { label: 'C', query: 'Potsdamer Platz' }
    ];

    const result = validatePeopleInputs(inputs);
    assert.equal(result.ok, true);
    assert.deepEqual(result.people, inputs);
});
