interface QueuedEvent {
  time: number;
  /** Laufnummer: Ereignisse zur selben Zeit laufen in Einfügereihenfolge, das macht die Simulation deterministisch. */
  seq: number;
  run: () => void;
}

const before = (a: QueuedEvent, b: QueuedEvent) => a.time < b.time || (a.time === b.time && a.seq < b.seq);

/** Prioritätswarteschlange (binärer Heap) nach Zeitpunkt. */
export class EventQueue {
  #heap: QueuedEvent[] = [];
  #seq = 0;

  get size(): number {
    return this.#heap.length;
  }

  peekTime(): number | undefined {
    return this.#heap[0]?.time;
  }

  push(time: number, run: () => void) {
    const heap = this.#heap;
    heap.push({ time, seq: this.#seq++, run });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i]!, heap[parent]!)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
      i = parent;
    }
  }

  pop(): QueuedEvent | undefined {
    const heap = this.#heap;
    const top = heap[0];
    const last = heap.pop();
    if (!top || !last || heap.length === 0) return top;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && before(heap[left]!, heap[smallest]!)) smallest = left;
      if (right < heap.length && before(heap[right]!, heap[smallest]!)) smallest = right;
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
      i = smallest;
    }
    return top;
  }

  clear() {
    this.#heap = [];
  }
}
