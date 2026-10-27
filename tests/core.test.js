import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { PriorityQueue } from '../src/core/priority-queue.js';
import { ExecutionController, Status } from '../src/core/execution-controller.js';
import { makeEvent } from '../src/core/trace.js';
import { fakeScheduler } from './helpers.js';

test('RNG: misma semilla produce la misma secuencia; semillas distintas difieren', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  const sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
  assert.deepEqual(createRng('texto').shuffle([1, 2, 3, 4, 5]), createRng('texto').shuffle([1, 2, 3, 4, 5]));
});

test('RNG: int está en el rango y cubre ambos extremos', () => {
  const rng = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = rng.int(3, 6);
    assert.ok(v >= 3 && v <= 6);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
});

test('Cola de prioridad: extrae en orden de prioridad, desempate y orden de inserción', () => {
  const pq = new PriorityQueue();
  const rng = createRng(1);
  const values = Array.from({ length: 500 }, () => rng.int(0, 50));
  values.forEach((v, i) => pq.push(i, v));
  const out = [];
  while (!pq.isEmpty()) out.push(pq.pop());
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].priority <= out[i].priority);
    if (out[i - 1].priority === out[i].priority) assert.ok(out[i - 1].item < out[i].item, 'FIFO en empates');
  }
  const q2 = new PriorityQueue();
  q2.push('a', 1, 5);
  q2.push('b', 1, 2);
  assert.equal(q2.pop().item, 'b');
  assert.equal(new PriorityQueue().pop(), undefined);
  assert.throws(() => new PriorityQueue().push('x', NaN));
});

// Algoritmo de juguete: suma 1..n emitiendo un evento por suma.
function* counter(n, log = null) {
  let total = 0;
  try {
    for (let i = 1; i <= n; i++) {
      total += i;
      yield makeEvent('add', `suma ${i}`, { i, total });
    }
    return { total };
  } finally {
    if (log) log.closed = true;
  }
}
const sumModel = {
  init: () => ({ total: 0, last: 0 }),
  apply: (s, e) => { s.total = e.data.total; s.last = e.data.i; },
  clone: (s) => ({ ...s }),
};

test('Controlador: avanza extrayendo eventos reales y numera los pasos', () => {
  const c = new ExecutionController({ createRun: () => counter(5), model: sumModel, scheduler: fakeScheduler() });
  assert.equal(c.status, Status.IDLE);
  assert.equal(c.stepForward(), true);
  assert.equal(c.position, 1);
  assert.equal(c.currentEvent.step, 1);
  assert.equal(c.state.total, 1);
  assert.equal(c.generatedEvents, 1, 'solo se ha generado lo necesario (ejecución perezosa)');
  c.runToEndSync();
  assert.equal(c.status, Status.FINISHED);
  assert.deepEqual(c.result, { total: 15 });
  assert.equal(c.position, 5);
  assert.equal(c.stepForward(), false);
});

test('Controlador: retroceder y saltar reproducen exactamente el estado', () => {
  // Intervalo de puntos de control pequeño para forzar restauraciones.
  const c = new ExecutionController({ createRun: () => counter(50), model: sumModel, checkpointInterval: 7, scheduler: fakeScheduler() });
  c.runToEndSync();
  const expectedAt = (k) => (k * (k + 1)) / 2;
  for (const k of [49, 30, 14, 7, 6, 1, 0, 33]) {
    c.goTo(k);
    assert.equal(c.position, k);
    assert.equal(c.state.total, expectedAt(k));
  }
  c.goTo(10);
  assert.equal(c.stepBack(), true);
  assert.equal(c.state.total, expectedAt(9));
  c.goTo(0);
  assert.equal(c.stepBack(), false);
  assert.equal(c.canStepBack, false);
});

test('Controlador: reproducción con temporizador, pausa, velocidad y fin', () => {
  const scheduler = fakeScheduler();
  const c = new ExecutionController({ createRun: () => counter(10), model: sumModel, scheduler });
  c.setSpeed(10);
  c.play();
  assert.equal(c.status, Status.RUNNING);
  scheduler.tick();
  assert.equal(c.position, 1);
  scheduler.tick();
  assert.equal(c.position, 2);
  c.pause();
  assert.equal(c.status, Status.PAUSED);
  assert.equal(c.hasActiveTimer(), false);
  scheduler.flush();
  assert.equal(c.position, 2, 'en pausa no avanza');
  c.setSpeed(1000); // varios eventos por tick
  c.resume();
  scheduler.flush();
  assert.equal(c.status, Status.FINISHED);
  assert.equal(c.position, 10);
  assert.equal(scheduler.timers.size, 0);
  assert.throws(() => c.setSpeed(0));
});

test('Controlador: ejecutar hasta el final por bloques y cancelar', async () => {
  const scheduler = fakeScheduler();
  const c = new ExecutionController({ createRun: () => counter(1000), model: sumModel, scheduler, chunkBudgetMs: 50 });
  const promise = c.runToEnd();
  scheduler.tick();
  assert.ok(c.position > 0 && c.position < 1000, 'procesa un bloque y cede el control');
  c.pause();
  const info = await promise;
  assert.equal(info.status, Status.PAUSED);
  assert.equal(scheduler.timers.size, 0);
  const p2 = c.runToEnd();
  scheduler.flush();
  const done = await p2;
  assert.equal(done.status, Status.FINISHED);
  assert.equal(c.state.total, 500500);
});

test('Controlador: detener cierra el generador y no deja temporizadores', () => {
  const scheduler = fakeScheduler();
  const log = {};
  const c = new ExecutionController({ createRun: () => counter(100, log), model: sumModel, scheduler });
  c.play();
  scheduler.tick();
  scheduler.tick();
  c.stop();
  assert.equal(c.status, Status.STOPPED);
  assert.equal(log.closed, true, 'se ejecuta el finally del algoritmo');
  assert.equal(scheduler.timers.size, 0);
  assert.equal(c.stepForward(), false, 'no se puede continuar tras detener');
  assert.equal(c.stepBack(), true, 'pero sí revisar lo registrado');
  c.reset();
  assert.equal(c.status, Status.IDLE);
  assert.equal(c.position, 0);
  c.runToEndSync();
  assert.equal(c.state.total, 5050, 'tras reiniciar se ejecuta un generador nuevo');
});

test('Controlador: límite de eventos almacenados', () => {
  const c = new ExecutionController({ createRun: () => counter(100), model: sumModel, maxEvents: 30, scheduler: fakeScheduler() });
  c.runToEndSync();
  assert.equal(c.status, Status.FINISHED);
  assert.equal(c.storedEvents, 30);
  assert.equal(c.generatedEvents, 100);
  assert.equal(c.truncated, true);
  assert.equal(c.state.total, 5050, 'el estado final se calcula aunque no se guarden los eventos');
  assert.equal(c.canStepBack, false);
  assert.equal(c.goTo(10), false);
});

test('Controlador: un error del algoritmo se informa y detiene la ejecución', () => {
  function* broken() {
    yield makeEvent('add', 'ok', { i: 1, total: 1 });
    throw new Error('fallo interno');
  }
  const scheduler = fakeScheduler();
  const c = new ExecutionController({ createRun: broken, model: sumModel, scheduler });
  c.play();
  scheduler.flush();
  assert.equal(c.status, Status.ERROR);
  assert.match(c.error.message, /fallo interno/);
  assert.equal(scheduler.timers.size, 0);
});

test('Controlador: dispose cancela todo', () => {
  const scheduler = fakeScheduler();
  const log = {};
  const c = new ExecutionController({ createRun: () => counter(100, log), model: sumModel, scheduler });
  let notifications = 0;
  c.subscribe(() => notifications++);
  c.play();
  scheduler.tick();
  c.dispose();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(log.closed, true);
  const before = notifications;
  c.stepBack();
  assert.equal(notifications, before, 'sin escuchadores tras dispose');
});
