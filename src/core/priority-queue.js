/**
 * Cola de prioridad de mínimos basada en un montículo binario.
 *
 * Cada entrada se ordena por (prioridad, desempate, orden de inserción). El orden de
 * inserción hace que el comportamiento sea determinista cuando hay empates, algo
 * imprescindible para que las trazas sean reproducibles.
 */
export class PriorityQueue {
  #heap = [];
  #counter = 0;

  get size() {
    return this.#heap.length;
  }

  isEmpty() {
    return this.#heap.length === 0;
  }

  push(item, priority, tieBreak = 0) {
    if (Number.isNaN(priority)) throw new Error('La prioridad no puede ser NaN.');
    const entry = { item, priority, tieBreak, order: this.#counter++ };
    this.#heap.push(entry);
    this.#siftUp(this.#heap.length - 1);
  }

  peek() {
    const top = this.#heap[0];
    return top ? { item: top.item, priority: top.priority, tieBreak: top.tieBreak } : undefined;
  }

  pop() {
    const heap = this.#heap;
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      this.#siftDown(0);
    }
    return { item: top.item, priority: top.priority, tieBreak: top.tieBreak };
  }

  /** Copia de las entradas (sin orden garantizado), útil para inspección. */
  entries() {
    return this.#heap.map((e) => ({ item: e.item, priority: e.priority, tieBreak: e.tieBreak }));
  }

  #less(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    if (a.tieBreak !== b.tieBreak) return a.tieBreak < b.tieBreak;
    return a.order < b.order;
  }

  #siftUp(index) {
    const heap = this.#heap;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#less(heap[index], heap[parent])) break;
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
  }

  #siftDown(index) {
    const heap = this.#heap;
    const n = heap.length;
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let smallest = index;
      if (left < n && this.#less(heap[left], heap[smallest])) smallest = left;
      if (right < n && this.#less(heap[right], heap[smallest])) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }
}
