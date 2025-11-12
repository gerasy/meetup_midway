import test from 'node:test';
import assert from 'node:assert/strict';
import { MinHeap } from '../src/queue.js';

test('MinHeap pops entries in priority order', () => {
    const heap = new MinHeap();
    heap.push([5, 0], 'a');
    heap.push([2, 0], 'b');
    heap.push([3, 0], 'c');
    assert.equal(heap.pop().data, 'b');
    assert.equal(heap.pop().data, 'c');
    assert.equal(heap.pop().data, 'a');
});

test('MinHeap stable ordering with equal priorities', () => {
    const heap = new MinHeap();
    heap.push([1, 0], 'first');
    heap.push([1, 0], 'second');
    assert.equal(heap.pop().data, 'first');
    assert.equal(heap.pop().data, 'second');
});
