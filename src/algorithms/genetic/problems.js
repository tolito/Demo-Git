import { createRng } from '../../core/rng.js';

/**
 * Problemas de demostración para el motor genético, con sus operadores y su
 * solución exacta de referencia (cuando es factible calcularla).
 */

// ------------------------------------------------------------- utilidades

function bitFlipMutation(bits, rate, rng) {
  const out = bits.slice();
  const changes = [];
  for (let i = 0; i < out.length; i++) {
    if (rng.next() < rate) {
      out[i] = out[i] ? 0 : 1;
      changes.push(`bit ${i}`);
    }
  }
  return { individual: out, changes };
}

function onePointCrossover(a, b, rng) {
  const point = rng.int(1, a.length - 1);
  return {
    children: [[...a.slice(0, point), ...b.slice(point)], [...b.slice(0, point), ...a.slice(point)]],
    detail: `un punto, corte en ${point}`,
  };
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d / a.length;
}

const isBinary = (bits, length) => Array.isArray(bits) && bits.length === length && bits.every((b) => b === 0 || b === 1);

// ------------------------------------------------- 1. Maximizar una función

/**
 * Maximizar f(x) = x · sin(10πx) + 1 en el dominio [-1, 2].
 * Representación: cadena de `bits` bits que codifica x linealmente en el
 * dominio, de modo que todo individuo es un x válido (la restricción de
 * dominio se cumple por construcción). La función es multimodal: tiene muchos
 * máximos locales, lo que permite observar convergencias prematuras.
 */
export function functionProblem({ bits = 22, min = -1, max = 2 } = {}) {
  if (!Number.isInteger(bits) || bits < 4 || bits > 24) throw new RangeError('El número de bits debe estar entre 4 y 24.');
  const levels = 2 ** bits - 1;
  const f = (x) => x * Math.sin(10 * Math.PI * x) + 1;
  const decodeInt = (ind) => ind.reduce((acc, b) => acc * 2 + b, 0);
  const decode = (ind) => min + (decodeInt(ind) / levels) * (max - min);
  return {
    id: 'function',
    name: 'Maximizar f(x) = x·sin(10πx) + 1',
    objective: `Maximizar f(x) = x·sin(10πx) + 1 con x ∈ [${min}, ${max}].`,
    constraints: `x se codifica con ${bits} bits; toda cadena representa un x del dominio (resolución ${((max - min) / levels).toExponential(2)}).`,
    limitations: 'El AG puede quedar atrapado en un máximo local; la precisión está limitada por el número de bits.',
    f,
    min,
    max,
    bits,
    decode,
    randomIndividual: (rng) => Array.from({ length: bits }, () => (rng.next() < 0.5 ? 1 : 0)),
    fitness: (ind) => f(decode(ind)),
    crossover: onePointCrossover,
    mutate: bitFlipMutation,
    isValid: (ind) => isBinary(ind, bits),
    distance: hamming,
    encode: (ind) => ind.join(''),
    describe: (ind) => `x = ${decode(ind).toFixed(6)}, f(x) = ${f(decode(ind)).toFixed(6)}`,
    formatFitness: (v) => v.toFixed(4),
    summarizePopulation: (pop, fit) => pop.map((ind, i) => [decode(ind), fit[i]]),
    /** Búsqueda exhaustiva sobre las 2^bits codificaciones: óptimo exacto de la representación. */
    exact() {
      let best = -Infinity;
      let bestX = min;
      for (let k = 0; k <= levels; k++) {
        const x = min + (k / levels) * (max - min);
        const v = f(x);
        if (v > best) {
          best = v;
          bestX = x;
        }
      }
      return { fitness: best, description: `x = ${bestX.toFixed(6)}, f(x) = ${best.toFixed(6)}`, method: `búsqueda exhaustiva de ${levels + 1} valores` };
    },
  };
}

// ------------------------------------------------------------- 2. Mochila

export const DEFAULT_KNAPSACK = Object.freeze({
  capacity: 50,
  items: [
    { name: 'Tienda', weight: 12, value: 24 }, { name: 'Saco', weight: 7, value: 13 },
    { name: 'Hornillo', weight: 11, value: 23 }, { name: 'Linterna', weight: 8, value: 15 },
    { name: 'Libro', weight: 9, value: 16 }, { name: 'Cámara', weight: 4, value: 9 },
    { name: 'Agua', weight: 10, value: 21 }, { name: 'Comida', weight: 6, value: 14 },
    { name: 'Botiquín', weight: 3, value: 10 }, { name: 'Mapa', weight: 1, value: 4 },
    { name: 'Cuerda', weight: 5, value: 9 }, { name: 'Prismáticos', weight: 6, value: 11 },
    { name: 'Navaja', weight: 2, value: 6 }, { name: 'Abrigo', weight: 9, value: 17 },
    { name: 'Batería', weight: 4, value: 7 },
  ],
});

export function randomKnapsack(seed = 1, { items = 20 } = {}) {
  const rng = createRng(seed);
  const list = Array.from({ length: items }, (_, i) => {
    const weight = rng.int(1, 20);
    return { name: `Objeto ${i + 1}`, weight, value: rng.int(1, 30) };
  });
  const total = list.reduce((s, it) => s + it.weight, 0);
  return { capacity: Math.floor(total * 0.4), items: list };
}

/**
 * Mochila 0/1: maximizar el valor total sin superar la capacidad.
 * Representación binaria (1 = el objeto va en la mochila). Tras el cruce y la
 * mutación se aplica una reparación determinista: mientras se supere la
 * capacidad se retira el objeto incluido con peor relación valor/peso. Así
 * todos los individuos de la población son factibles.
 */
export function knapsackProblem(instance = DEFAULT_KNAPSACK) {
  const { capacity, items } = instance;
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error('La capacidad debe ser un entero no negativo.');
  if (items.some((it) => !Number.isInteger(it.weight) || it.weight <= 0 || !Number.isFinite(it.value) || it.value < 0)) {
    throw new Error('Cada objeto necesita un peso entero positivo y un valor no negativo.');
  }
  const n = items.length;
  const byRatio = items.map((it, i) => i).sort((a, b) => items[a].value / items[a].weight - items[b].value / items[b].weight);
  const weightOf = (ind) => ind.reduce((s, b, i) => s + (b ? items[i].weight : 0), 0);
  const valueOf = (ind) => ind.reduce((s, b, i) => s + (b ? items[i].value : 0), 0);
  function repair(ind) {
    const out = ind.slice();
    let w = weightOf(out);
    const removed = [];
    for (const i of byRatio) {
      if (w <= capacity) break;
      if (out[i]) {
        out[i] = 0;
        w -= items[i].weight;
        removed.push(items[i].name);
      }
    }
    return { individual: out, removed };
  }
  return {
    id: 'knapsack',
    name: 'Mochila 0/1',
    objective: `Maximizar el valor total de los objetos elegidos (${n} objetos).`,
    constraints: `Peso total ≤ ${capacity}. Se garantiza reparando los individuos que la violan.`,
    limitations: 'La reparación sesga la búsqueda hacia objetos con buena relación valor/peso; no garantiza el óptimo.',
    items,
    capacity,
    weightOf,
    valueOf,
    randomIndividual(rng) {
      // Inicialización con probabilidad baja para empezar cerca de la factibilidad.
      return repair(Array.from({ length: n }, () => (rng.next() < 0.3 ? 1 : 0))).individual;
    },
    fitness: valueOf,
    crossover(a, b, rng) {
      const { children, detail } = onePointCrossover(a, b, rng);
      return { children: children.map((c) => repair(c).individual), detail: `${detail}, con reparación` };
    },
    mutate(ind, rate, rng) {
      const { individual, changes } = bitFlipMutation(ind, rate, rng);
      if (!changes.length) return { individual: ind, changes };
      const repaired = repair(individual);
      if (repaired.removed.length) changes.push(`reparación: se retira ${repaired.removed.join(', ')}`);
      return { individual: repaired.individual, changes };
    },
    isValid: (ind) => isBinary(ind, n) && weightOf(ind) <= capacity,
    distance: hamming,
    encode: (ind) => ind.join(''),
    describe: (ind) => `valor ${valueOf(ind)}, peso ${weightOf(ind)}/${capacity}: ${items.filter((_, i) => ind[i]).map((it) => it.name).join(', ') || '(vacía)'}`,
    formatFitness: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2)),
    /** Programación dinámica O(n · capacidad): óptimo exacto. */
    exact() {
      const dp = new Float64Array(capacity + 1);
      const take = Array.from({ length: n }, () => new Uint8Array(capacity + 1));
      for (let i = 0; i < n; i++) {
        const { weight, value } = items[i];
        for (let w = capacity; w >= weight; w--) {
          if (dp[w - weight] + value > dp[w]) {
            dp[w] = dp[w - weight] + value;
            take[i][w] = 1;
          }
        }
      }
      const chosen = new Array(n).fill(0);
      let w = capacity;
      for (let i = n - 1; i >= 0; i--) {
        if (take[i][w]) {
          chosen[i] = 1;
          w -= items[i].weight;
        }
      }
      return { fitness: dp[capacity], individual: chosen, description: `valor ${dp[capacity]} (${items.filter((_, i) => chosen[i]).map((it) => it.name).join(', ')})`, method: 'programación dinámica' };
    },
  };
}

// ------------------------------------------------------ 3. Rutas (TSP)

export function randomCities(seed = 1, count = 9) {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => ({ name: String.fromCharCode(65 + i), x: Math.round(rng.range(5, 95)), y: Math.round(rng.range(5, 95)) }));
}

/**
 * Viajante (TSP) simétrico: ciclo de longitud mínima que visita todas las
 * ciudades una vez. Representación: permutación de las ciudades 1..n-1 (la
 * ciudad 0 es siempre el origen y no se codifica, lo que elimina rotaciones
 * equivalentes). Operadores que preservan permutaciones:
 *   - cruce de orden (OX),
 *   - mutación por inversión de un segmento (por individuo, con probabilidad
 *     igual a la tasa de mutación multiplicada por la longitud, acotada a 1).
 * Aptitud = −longitud del recorrido (se maximiza).
 */
export function tspProblem(cities = randomCities(7, 9)) {
  if (cities.length < 4 || cities.length > 30) throw new RangeError('Se necesitan entre 4 y 30 ciudades.');
  const n = cities.length;
  const dist = cities.map((a) => cities.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  const tourLength = (perm) => {
    let total = dist[0][perm[0]];
    for (let i = 1; i < perm.length; i++) total += dist[perm[i - 1]][perm[i]];
    return total + dist[perm[perm.length - 1]][0];
  };
  const edges = (perm) => {
    const set = new Set();
    const full = [0, ...perm, 0];
    for (let i = 1; i < full.length; i++) {
      const a = full[i - 1];
      const b = full[i];
      set.add(a < b ? a * n + b : b * n + a);
    }
    return set;
  };
  const isPermutation = (perm) => {
    if (!Array.isArray(perm) || perm.length !== n - 1) return false;
    const seen = new Set(perm);
    return seen.size === n - 1 && perm.every((c) => Number.isInteger(c) && c >= 1 && c < n);
  };
  return {
    id: 'tsp',
    name: `Viajante (${n} ciudades)`,
    objective: 'Minimizar la longitud del ciclo que visita todas las ciudades (aptitud = −longitud).',
    constraints: 'Cada ciudad se visita exactamente una vez; los operadores OX e inversión mantienen permutaciones válidas.',
    limitations: 'Para muchas ciudades el AG solo ofrece buenas aproximaciones; la comparación exacta solo es factible hasta 12 ciudades.',
    cities,
    tourLength,
    randomIndividual: (rng) => rng.shuffle(Array.from({ length: n - 1 }, (_, i) => i + 1)),
    fitness: (perm) => -tourLength(perm),
    crossover(a, b, rng) {
      const len = a.length;
      const i = rng.int(0, len - 1);
      const j = rng.int(0, len - 1);
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const ox = (p, q) => {
        const child = new Array(len).fill(-1);
        const used = new Set();
        for (let k = lo; k <= hi; k++) {
          child[k] = p[k];
          used.add(p[k]);
        }
        let pos = (hi + 1) % len;
        for (let k = 0; k < len; k++) {
          const gene = q[(hi + 1 + k) % len];
          if (used.has(gene)) continue;
          child[pos] = gene;
          used.add(gene);
          pos = (pos + 1) % len;
        }
        return child;
      };
      return { children: [ox(a, b), ox(b, a)], detail: `OX, segmento ${lo}–${hi}` };
    },
    mutate(perm, rate, rng) {
      const probability = Math.min(1, rate * perm.length);
      if (rng.next() >= probability) return { individual: perm, changes: [] };
      const i = rng.int(0, perm.length - 1);
      const j = rng.int(0, perm.length - 1);
      if (i === j) return { individual: perm, changes: [] };
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const out = [...perm.slice(0, lo), ...perm.slice(lo, hi + 1).reverse(), ...perm.slice(hi + 1)];
      return { individual: out, changes: [`inversión ${lo}–${hi}`] };
    },
    isValid: isPermutation,
    distance(a, b) {
      const ea = edges(a);
      const eb = edges(b);
      let shared = 0;
      for (const e of ea) if (eb.has(e)) shared++;
      return 1 - shared / n;
    },
    encode: (perm) => [0, ...perm].map((c) => cities[c].name).join(''),
    describe: (perm) => `${[0, ...perm, 0].map((c) => cities[c].name).join('→')} (longitud ${tourLength(perm).toFixed(2)})`,
    formatFitness: (v) => v.toFixed(2),
    /** Programación dinámica de Held-Karp, O(n²·2ⁿ): óptimo exacto para n <= 12. */
    exact() {
      if (n > 12) return null;
      const size = 1 << (n - 1);
      const dp = new Float64Array(size * n).fill(Infinity);
      const parent = new Int8Array(size * n).fill(-1);
      for (let c = 1; c < n; c++) dp[(1 << (c - 1)) * n + c] = dist[0][c];
      for (let mask = 1; mask < size; mask++) {
        for (let last = 1; last < n; last++) {
          const cur = dp[mask * n + last];
          if (!(mask & (1 << (last - 1))) || cur === Infinity) continue;
          for (let next = 1; next < n; next++) {
            if (mask & (1 << (next - 1))) continue;
            const nm = mask | (1 << (next - 1));
            const cand = cur + dist[last][next];
            if (cand < dp[nm * n + next]) {
              dp[nm * n + next] = cand;
              parent[nm * n + next] = last;
            }
          }
        }
      }
      const full = size - 1;
      let best = Infinity;
      let last = -1;
      for (let c = 1; c < n; c++) {
        const v = dp[full * n + c] + dist[c][0];
        if (v < best) {
          best = v;
          last = c;
        }
      }
      const perm = [];
      let mask = full;
      while (last !== -1 && mask) {
        perm.push(last);
        const prev = parent[mask * n + last];
        mask &= ~(1 << (last - 1));
        last = prev;
      }
      perm.reverse();
      return { fitness: -best, individual: perm, description: `longitud ${best.toFixed(2)}: ${[0, ...perm, 0].map((c) => cities[c].name).join('→')}`, method: 'Held-Karp (programación dinámica)' };
    },
  };
}

export const GENETIC_PROBLEMS = Object.freeze({
  function: { id: 'function', name: 'Maximizar una función', create: () => functionProblem() },
  knapsack: { id: 'knapsack', name: 'Mochila 0/1', create: () => knapsackProblem() },
  tsp: { id: 'tsp', name: 'Viajante (permutaciones)', create: () => tspProblem() },
});
