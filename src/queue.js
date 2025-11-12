export class MinHeap {
    constructor() {
        this.heap = [];
        this.counter = 0;
    }

    push(priority, data) {
        this.counter++;
        this.heap.push({ priority, counter: this.counter, data });
        this.bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        return min;
    }

    bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2);
            if (this.compare(this.heap[idx], this.heap[parentIdx]) >= 0) break;
            [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
            idx = parentIdx;
        }
    }

    bubbleDown(idx) {
        while (true) {
            let minIdx = idx;
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;

            if (left < this.heap.length && this.compare(this.heap[left], this.heap[minIdx]) < 0) {
                minIdx = left;
            }
            if (right < this.heap.length && this.compare(this.heap[right], this.heap[minIdx]) < 0) {
                minIdx = right;
            }

            if (minIdx === idx) break;
            [this.heap[idx], this.heap[minIdx]] = [this.heap[minIdx], this.heap[idx]];
            idx = minIdx;
        }
    }

    compare(a, b) {
        for (let i = 0; i < a.priority.length; i++) {
            if (a.priority[i] < b.priority[i]) return -1;
            if (a.priority[i] > b.priority[i]) return 1;
        }
        return a.counter - b.counter;
    }

    get length() {
        return this.heap.length;
    }
}
