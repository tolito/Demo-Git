/**
 * Generador pseudoaleatorio reproducible (mulberry32).
 *
 * Se usa en todos los puntos donde interviene el azar (laberintos, generación de
 * Sudokus, algoritmos genéticos, experimentos) para que una misma semilla produzca
 * exactamente la misma secuencia en cualquier navegador o en Node.
 */

/** Convierte una semilla numérica o textual en un entero de 32 bits sin signo. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (Math.trunc(seed) >>> 0);
  }
  // Hash FNV-1a para semillas de texto.
  const text = String(seed ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed = 1) {
  let state = normalizeSeed(seed);

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** Entero uniforme en [min, max] (ambos incluidos). */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** Real uniforme en [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
    pick(array) {
      if (array.length === 0) throw new Error('No se puede elegir un elemento de una lista vacía.');
      return array[Math.floor(next() * array.length)];
    },
    /** Mezcla Fisher-Yates in situ; devuelve el mismo array. */
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = array[i];
        array[i] = array[j];
        array[j] = tmp;
      }
      return array;
    },
    getState() {
      return state;
    },
    setState(value) {
      state = value >>> 0;
    },
  };
}
