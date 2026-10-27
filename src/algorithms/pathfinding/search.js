import { PriorityQueue } from '../../core/priority-queue.js';
import { makeEvent } from '../../core/trace.js';
import { MOVEMENT, formatCell, isWalkable, measurePath, minCellCost, neighbors } from './grid.js';
import { defaultHeuristicFor, getHeuristic, isAdmissible, makeHeuristicFn } from './heuristics.js';

/**
 * Algoritmos de búsqueda de caminos sobre la cuadrícula.
 *
 * Todos son generadores que emiten eventos (si `trace` es true) y devuelven un
 * resultado con la misma forma, para poder compararlos:
 *   { found, path, moves, geometricLength, cost, metrics, optimality, ... }
 *
 * Métricas (todas contadas durante la ejecución real):
 *  - expanded: nodos extraídos de la frontera y procesados.
 *  - discovered: nodos distintos que llegaron a la frontera.
 *  - pushes / pops: inserciones y extracciones en la frontera.
 *  - edgeChecks: aristas (vecinos) examinadas.
 *  - relaxations: mejoras de distancia (solo Dijkstra y A*).
 *  - frontierPeak: tamaño máximo de la frontera.
 *  - memoryPeak: máximo de entradas simultáneas en frontera + tabla de
 *    predecesores; es una estimación del uso de memoria en número de entradas.
 */

function createMetrics() {
  return {
    expanded: 0,
    discovered: 0,
    pushes: 0,
    pops: 0,
    edgeChecks: 0,
    relaxations: 0,
    staleSkips: 0,
    frontierSize: 0,
    frontierPeak: 0,
    memoryPeak: 0,
  };
}

function trackFrontier(metrics, size) {
  metrics.frontierSize = size;
  if (size > metrics.frontierPeak) metrics.frontierPeak = size;
  const memory = size + metrics.discovered;
  if (memory > metrics.memoryPeak) metrics.memoryPeak = memory;
}

function reconstructPath(parent, start, goal) {
  const path = [];
  let current = goal;
  const guard = parent.length + 1;
  while (current !== -1) {
    path.push(current);
    if (current === start) break;
    current = parent[current];
    if (path.length > guard) throw new Error('Ciclo detectado al reconstruir el camino.');
  }
  path.reverse();
  if (path[0] !== start) throw new Error('El camino reconstruido no comienza en el origen.');
  return path;
}

function* finish(ctx, found, parent) {
  const { grid, movement, metrics, trace, algorithm } = ctx;
  if (!found) {
    if (trace) {
      yield makeEvent('no-path', 'La frontera se ha vaciado sin alcanzar el destino: no existe camino.', {}, metrics);
    }
    return {
      algorithm,
      found: false,
      path: [],
      moves: 0,
      geometricLength: 0,
      cost: Infinity,
      metrics: { ...metrics },
      optimality: ctx.optimality,
    };
  }
  const path = reconstructPath(parent, grid.start, grid.goal);
  // El coste se recalcula desde el camino, no desde la etiqueta g del algoritmo.
  const measured = measurePath(grid, path, movement);
  if (trace) {
    yield makeEvent(
      'path',
      `Camino reconstruido desde los predecesores: ${measured.moves} movimientos, coste ${measured.cost.toFixed(2)}.`,
      { path },
      metrics,
    );
  }
  return {
    algorithm,
    found: true,
    path,
    moves: measured.moves,
    geometricLength: measured.geometricLength,
    cost: measured.cost,
    metrics: { ...metrics },
    optimality: ctx.optimality,
  };
}

function* checkTrivialCases(ctx) {
  const { grid, metrics, trace } = ctx;
  if (!isWalkable(grid, grid.start) || !isWalkable(grid, grid.goal)) {
    if (trace) yield makeEvent('no-path', 'El origen o el destino es un obstáculo: no hay camino posible.', {}, metrics);
    return { done: true, found: false };
  }
  return { done: false };
}

function context(grid, options, algorithm, optimality) {
  return {
    grid,
    movement: options.movement ?? MOVEMENT.ORTHOGONAL,
    trace: options.trace !== false,
    metrics: createMetrics(),
    algorithm,
    optimality,
  };
}

/**
 * Búsqueda en anchura. Expande por capas (número de movimientos), por lo que
 * encuentra el camino con menos movimientos. Ignora los costes de las celdas:
 * solo es óptima en coste si todos los movimientos cuestan lo mismo.
 */
export function* bfs(grid, options = {}) {
  const uniform = isUniformCost(grid, options.movement);
  const ctx = context(grid, options, 'bfs', {
    guaranteed: uniform,
    note: uniform
      ? 'Óptimo: todos los movimientos tienen el mismo coste.'
      : 'Minimiza el número de movimientos, no el coste: hay costes o diagonales distintos.',
  });
  const { metrics, trace, movement } = ctx;
  const n = grid.walls.length;
  const parent = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n).fill(-1);
  if (trace) yield makeEvent('init', `BFS desde ${formatCell(grid, grid.start)} hacia ${formatCell(grid, grid.goal)}.`, { start: grid.start, goal: grid.goal }, metrics);
  const trivial = yield* checkTrivialCases(ctx);
  if (trivial.done) return yield* finish(ctx, false, parent);

  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = grid.start;
  depth[grid.start] = 0;
  metrics.discovered = 1;
  metrics.pushes = 1;
  trackFrontier(metrics, 1);
  if (trace) yield makeEvent('discover', `Origen ${formatCell(grid, grid.start)} añadido a la cola.`, { index: grid.start, g: 0, parent: -1 }, metrics);

  while (head < tail) {
    const current = queue[head++];
    metrics.pops++;
    metrics.expanded++;
    trackFrontier(metrics, tail - head);
    if (trace) yield makeEvent('expand', `Se extrae ${formatCell(grid, current)} de la cola (profundidad ${depth[current]}).`, { index: current, g: depth[current] }, metrics);
    if (current === grid.goal) {
      if (trace) yield makeEvent('goal', `Destino alcanzado en ${depth[current]} movimientos.`, { index: current }, metrics);
      return yield* finish(ctx, true, parent);
    }
    for (const nb of neighbors(grid, current, movement)) {
      metrics.edgeChecks++;
      if (depth[nb.index] !== -1) continue;
      depth[nb.index] = depth[current] + 1;
      parent[nb.index] = current;
      queue[tail++] = nb.index;
      metrics.discovered++;
      metrics.pushes++;
      trackFrontier(metrics, tail - head);
      if (trace) {
        yield makeEvent('discover', `Descubierta ${formatCell(grid, nb.index)} desde ${formatCell(grid, current)} (profundidad ${depth[nb.index]}).`, { index: nb.index, g: depth[nb.index], parent: current }, metrics);
      }
    }
  }
  return yield* finish(ctx, false, parent);
}

/**
 * Búsqueda en profundidad con pila explícita. Encuentra *un* camino si existe,
 * sin ninguna garantía de optimalidad ni en movimientos ni en coste.
 * Una celda puede apilarse varias veces; al desapilarla se descarta si ya se
 * expandió. El predecesor se fija al expandir (orden DFS real).
 */
export function* dfs(grid, options = {}) {
  const ctx = context(grid, options, 'dfs', {
    guaranteed: false,
    note: 'Encuentra una ruta, pero no garantiza la más corta ni la más barata.',
  });
  const { metrics, trace, movement } = ctx;
  const n = grid.walls.length;
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const seen = new Uint8Array(n);
  if (trace) yield makeEvent('init', `DFS desde ${formatCell(grid, grid.start)} hacia ${formatCell(grid, grid.goal)}.`, { start: grid.start, goal: grid.goal }, metrics);
  const trivial = yield* checkTrivialCases(ctx);
  if (trivial.done) return yield* finish(ctx, false, parent);

  const stack = [[grid.start, -1]];
  seen[grid.start] = 1;
  metrics.discovered = 1;
  metrics.pushes = 1;
  trackFrontier(metrics, 1);
  if (trace) yield makeEvent('discover', `Origen ${formatCell(grid, grid.start)} apilado.`, { index: grid.start, g: 0, parent: -1 }, metrics);

  while (stack.length > 0) {
    const [current, from] = stack.pop();
    metrics.pops++;
    trackFrontier(metrics, stack.length);
    if (closed[current]) {
      if (trace) yield makeEvent('skip', `${formatCell(grid, current)} ya fue expandida; se descarta esta entrada de la pila.`, { index: current }, metrics);
      continue;
    }
    closed[current] = 1;
    parent[current] = from;
    metrics.expanded++;
    if (trace) yield makeEvent('expand', `Se desapila y expande ${formatCell(grid, current)}.`, { index: current }, metrics);
    if (current === grid.goal) {
      if (trace) yield makeEvent('goal', 'Destino alcanzado. DFS se detiene en la primera ruta encontrada.', { index: current }, metrics);
      return yield* finish(ctx, true, parent);
    }
    // Se apilan en orden inverso para explorar primero el primer vecino (N, E, S, O...).
    const list = neighbors(grid, current, movement);
    for (let i = list.length - 1; i >= 0; i--) {
      const nb = list[i];
      metrics.edgeChecks++;
      if (closed[nb.index]) continue;
      stack.push([nb.index, current]);
      metrics.pushes++;
      const first = !seen[nb.index];
      if (first) {
        seen[nb.index] = 1;
        metrics.discovered++;
      }
      trackFrontier(metrics, stack.length);
      if (trace) {
        yield makeEvent(first ? 'discover' : 'repush',
          first
            ? `Apilada ${formatCell(grid, nb.index)} (vecina de ${formatCell(grid, current)}).`
            : `${formatCell(grid, nb.index)} se apila de nuevo desde ${formatCell(grid, current)}; la entrada antigua quedará obsoleta.`,
          { index: nb.index, parent: current }, metrics);
      }
    }
  }
  return yield* finish(ctx, false, parent);
}

/**
 * Núcleo común de Dijkstra y A*: cola de prioridad con eliminación perezosa.
 * Las entradas obsoletas (con g mayor que la mejor conocida) se descartan al
 * extraerlas. Los nodos cerrados no se reabren, lo que es correcto con
 * costes no negativos y heurísticas consistentes.
 */
function* bestFirst(grid, options, { algorithm, heuristic, optimality, label }) {
  const ctx = context(grid, options, algorithm, optimality);
  const { metrics, trace, movement } = ctx;
  const n = grid.walls.length;
  const parent = new Int32Array(n).fill(-1);
  const g = new Float64Array(n).fill(Infinity);
  const closed = new Uint8Array(n);
  if (trace) yield makeEvent('init', `${label} desde ${formatCell(grid, grid.start)} hacia ${formatCell(grid, grid.goal)}.`, { start: grid.start, goal: grid.goal }, metrics);
  const trivial = yield* checkTrivialCases(ctx);
  if (trivial.done) return yield* finish(ctx, false, parent);

  const queue = new PriorityQueue();
  g[grid.start] = 0;
  const h0 = heuristic(grid.start);
  queue.push(grid.start, h0, h0);
  metrics.discovered = 1;
  metrics.pushes = 1;
  trackFrontier(metrics, 1);
  if (trace) yield makeEvent('discover', `Origen ${formatCell(grid, grid.start)} en la cola con g = 0${h0 ? `, h = ${h0.toFixed(2)}` : ''}.`, { index: grid.start, g: 0, h: h0, f: h0, parent: -1 }, metrics);

  while (!queue.isEmpty()) {
    const { item: current, priority } = queue.pop();
    metrics.pops++;
    trackFrontier(metrics, queue.size);
    const gCurrent = g[current];
    // Una entrada es obsoleta si el nodo ya se cerró o si se insertó con una g peor.
    if (closed[current] || priority - heuristic(current) > gCurrent + 1e-9) {
      metrics.staleSkips++;
      if (trace) yield makeEvent('skip', `Entrada obsoleta de ${formatCell(grid, current)} descartada (ya existe un camino mejor o el nodo está cerrado).`, { index: current }, metrics);
      continue;
    }
    closed[current] = 1;
    metrics.expanded++;
    if (trace) yield makeEvent('expand', `Se extrae ${formatCell(grid, current)} con g = ${gCurrent.toFixed(2)}${priority !== gCurrent ? `, f = ${priority.toFixed(2)}` : ''}.`, { index: current, g: gCurrent, f: priority }, metrics);
    if (current === grid.goal) {
      if (trace) yield makeEvent('goal', `Destino extraído de la cola con coste g = ${gCurrent.toFixed(2)}.`, { index: current }, metrics);
      return yield* finish(ctx, true, parent);
    }
    for (const nb of neighbors(grid, current, movement)) {
      metrics.edgeChecks++;
      if (closed[nb.index]) continue;
      const candidate = gCurrent + nb.cost;
      if (candidate < g[nb.index] - 1e-12) {
        const firstTime = g[nb.index] === Infinity;
        const previous = g[nb.index];
        g[nb.index] = candidate;
        parent[nb.index] = current;
        const h = heuristic(nb.index);
        queue.push(nb.index, candidate + h, h);
        metrics.pushes++;
        metrics.relaxations++;
        if (firstTime) metrics.discovered++;
        trackFrontier(metrics, queue.size);
        if (trace) {
          const detail = h ? ` (h = ${h.toFixed(2)}, f = ${(candidate + h).toFixed(2)})` : '';
          yield makeEvent(firstTime ? 'discover' : 'update',
            firstTime
              ? `Descubierta ${formatCell(grid, nb.index)} con g = ${candidate.toFixed(2)}${detail}.`
              : `Mejora de ${formatCell(grid, nb.index)}: g pasa de ${previous.toFixed(2)} a ${candidate.toFixed(2)} vía ${formatCell(grid, current)}.`,
            { index: nb.index, g: candidate, h, f: candidate + h, parent: current }, metrics);
        }
      }
    }
  }
  return yield* finish(ctx, false, parent);
}

export function* dijkstra(grid, options = {}) {
  return yield* bestFirst(grid, options, {
    algorithm: 'dijkstra',
    label: 'Dijkstra',
    heuristic: () => 0,
    optimality: { guaranteed: true, note: 'Óptimo en coste (todos los costes son positivos).' },
  });
}

export function* astar(grid, options = {}) {
  const movement = options.movement ?? MOVEMENT.ORTHOGONAL;
  const heuristicId = options.heuristic ?? defaultHeuristicFor(movement);
  const admissible = isAdmissible(heuristicId, movement);
  const h = makeHeuristicFn(grid, heuristicId, grid.goal, minCellCost(grid));
  return yield* bestFirst(grid, options, {
    algorithm: 'astar',
    label: `A* (${getHeuristic(heuristicId).name})`,
    heuristic: h,
    optimality: {
      guaranteed: admissible,
      note: admissible
        ? `Óptimo en coste: la heurística ${getHeuristic(heuristicId).name} es admisible y consistente con este movimiento.`
        : `Sin garantía: la heurística ${getHeuristic(heuristicId).name} no es admisible con movimiento diagonal.`,
    },
  });
}

/** True si todos los movimientos posibles tienen el mismo coste. */
export function isUniformCost(grid, movement = MOVEMENT.ORTHOGONAL) {
  if (movement === MOVEMENT.DIAGONAL) {
    // Con diagonales los pasos miden 1 o √2: el coste nunca es uniforme
    // salvo que no haya ningún movimiento diagonal posible; se trata como no uniforme.
    return false;
  }
  let value = -1;
  for (let i = 0; i < grid.costs.length; i++) {
    if (grid.walls[i]) continue;
    if (value === -1) value = grid.costs[i];
    else if (grid.costs[i] !== value) return false;
  }
  return true;
}

export const PATHFINDING_ALGORITHMS = Object.freeze({
  bfs: { id: 'bfs', name: 'BFS (anchura)', run: bfs, usesHeuristic: false, description: 'Explora por capas con una cola FIFO. Garantiza el mínimo número de movimientos; solo minimiza el coste si todos los movimientos cuestan igual.' },
  dfs: { id: 'dfs', name: 'DFS (profundidad)', run: dfs, usesHeuristic: false, description: 'Explora una rama hasta el fondo con una pila. Encuentra una ruta si existe, sin garantía de optimalidad.' },
  dijkstra: { id: 'dijkstra', name: 'Dijkstra', run: dijkstra, usesHeuristic: false, description: 'Expande siempre el nodo con menor coste acumulado g. Óptimo con costes no negativos.' },
  astar: { id: 'astar', name: 'A*', run: astar, usesHeuristic: true, description: 'Expande el nodo con menor f = g + h. Óptimo si h es admisible (y consistente, ya que no reabre nodos).' },
});
