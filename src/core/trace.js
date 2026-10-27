/**
 * Utilidades comunes para las trazas de eventos.
 *
 * Todos los algoritmos del laboratorio son funciones generadoras: cada `yield`
 * entrega un evento que describe una operación que el algoritmo acaba de realizar.
 * El valor de retorno del generador es el resultado final.
 *
 * Formato de un evento:
 *   { type, message, data, metrics }
 * El número de paso (`step`) lo asigna el controlador de ejecución.
 */

export function makeEvent(type, message, data = {}, metrics = undefined) {
  return { type, message, data, metrics: metrics ? { ...metrics } : undefined };
}

/**
 * Ejecuta un generador hasta el final sin visualización.
 * Devuelve el resultado y, opcionalmente, los eventos producidos.
 */
export function runToCompletion(generator, { collect = false, maxEvents = Infinity } = {}) {
  const events = [];
  let count = 0;
  for (;;) {
    const { value, done } = generator.next();
    if (done) return { result: value, events, eventCount: count };
    count++;
    if (collect && events.length < maxEvents) events.push(value);
  }
}

/** Mide el tiempo de una función en milisegundos con la mejor fuente disponible. */
export function now() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}
