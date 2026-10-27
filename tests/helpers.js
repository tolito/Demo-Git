/** Utilidades compartidas por las pruebas. */
import { runToCompletion } from '../src/core/trace.js';

export function run(generator) {
  return runToCompletion(generator).result;
}

export function runCollect(generator) {
  return runToCompletion(generator, { collect: true });
}

/**
 * Planificador falso para el controlador: los temporizadores no se ejecutan
 * hasta llamar a tick()/flush(), y el reloj avanza de forma controlada.
 */
export function fakeScheduler() {
  let id = 0;
  let clock = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(fn, ms) {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    now() {
      clock += 1;
      return clock;
    },
    /** Ejecuta los temporizadores pendientes en este momento (una ronda). */
    tick() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, t] of pending) t.fn();
      return pending.length;
    },
    /** Ejecuta rondas hasta que no queden temporizadores (con límite de seguridad). */
    flush(limit = 100000) {
      let rounds = 0;
      while (timers.size && rounds < limit) {
        this.tick();
        rounds++;
      }
      return rounds;
    },
  };
}
