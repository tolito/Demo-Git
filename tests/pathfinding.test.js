import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT, createGrid, measurePath, neighbors, toIndex } from '../src/algorithms/pathfinding/grid.js';
import { HEURISTICS, isAdmissible, makeHeuristicFn } from '../src/algorithms/pathfinding/heuristics.js';
import { SCENARIOS, generateMaze, generateRandomObstacles } from '../src/algorithms/pathfinding/maps.js';
import { PATHFINDING_ALGORITHMS, astar, bfs, dfs, dijkstra } from '../src/algorithms/pathfinding/search.js';
import { minCellCost } from '../src/algorithms/pathfinding/grid.js';
import { run, runCollect } from './helpers.js';

/**
 * Solución de referencia independiente: Bellman-Ford (relajación repetida de
 * todas las aristas hasta que no hay cambios). Devuelve el coste mínimo desde
 * `source` a cada celda, o, con reverse = true, desde cada celda hasta `source`.
 */
function referenceCosts(grid, source, movement, { reverse = false, unit = false } = {}) {
  const n = grid.walls.length;
  const dist = new Float64Array(n).fill(Infinity);
  if (grid.walls[source]) return dist;
  dist[source] = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let u = 0; u < n; u++) {
      if (grid.walls[u]) continue;
      for (const e of neighbors(grid, u, movement)) {
        const w = unit ? 1 : (reverse ? grid.costs[u] * e.stepLength : e.cost);
        // directo: u -> e.index ; inverso: e.index -> u (coste de entrar en u)
        const [from, to] = reverse ? [e.index, u] : [u, e.index];
        if (dist[from] + w < dist[to] - 1e-12) {
          dist[to] = dist[from] + w;
          changed = true;
        }
      }
    }
  }
  return dist;
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('Ruta directa en mapa vacío: todos encuentran camino y es válido', () => {
  const grid = createGrid(6, 2);
  for (let x = 0; x < 6; x++) grid.walls[toIndex(grid, x, 1)] = 1;
  grid.goal = 5;
  for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
    const r = run(algo.run(grid));
    assert.equal(r.found, true, algo.id);
    assert.deepEqual(r.path, [0, 1, 2, 3, 4, 5]);
    assert.equal(r.cost, 5);
    assert.equal(r.moves, 5);
  }
});

test('Origen igual a destino: camino de longitud cero', () => {
  const grid = createGrid(5, 5);
  grid.start = grid.goal = 12;
  for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
    const r = run(algo.run(grid));
    assert.equal(r.found, true);
    assert.deepEqual(r.path, [12]);
    assert.equal(r.cost, 0);
  }
});

test('Ruta bloqueada: todos detectan que no hay camino', () => {
  const grid = SCENARIOS.find((s) => s.id === 'no-path').build();
  for (const movement of Object.values(MOVEMENT)) {
    for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
      const { result, events } = runCollect(algo.run(grid, { movement }));
      assert.equal(result.found, false, `${algo.id} ${movement}`);
      assert.equal(result.cost, Infinity);
      assert.equal(events.at(-1).type, 'no-path');
    }
  }
  const walled = createGrid(4, 4);
  walled.walls[walled.goal] = 1;
  assert.equal(run(astar(walled)).found, false, 'destino sobre un obstáculo');
});

test('Obstáculos: el camino rodea el muro y nunca pisa obstáculos', () => {
  const grid = SCENARIOS.find((s) => s.id === 'wall-gap').build();
  for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
    const r = run(algo.run(grid));
    assert.equal(r.found, true);
    for (const cell of r.path) assert.equal(grid.walls[cell], 0);
    assert.doesNotThrow(() => measurePath(grid, r.path));
  }
});

test('Costes diferentes: BFS minimiza movimientos, Dijkstra y A* minimizan coste', () => {
  const grid = SCENARIOS.find((s) => s.id === 'terrain').build();
  const b = run(bfs(grid));
  const d = run(dijkstra(grid));
  const a = run(astar(grid, { heuristic: 'manhattan' }));
  assert.ok(b.moves <= d.moves);
  assert.ok(d.cost < b.cost, 'el camino más corto en pasos cruza el agua y es más caro');
  assert.ok(close(a.cost, d.cost));
  assert.equal(b.optimality.guaranteed, false);
  assert.equal(d.optimality.guaranteed, true);
});

test('Dijkstra y A* coinciden con la solución de referencia en mapas aleatorios', () => {
  for (let seed = 1; seed <= 25; seed++) {
    for (const movement of Object.values(MOVEMENT)) {
      const size = 6 + (seed % 9);
      const grid = generateRandomObstacles(size, size + 2, seed, { density: 0.25, terrain: seed % 2 === 0 });
      const ref = referenceCosts(grid, grid.start, movement);
      const expected = ref[grid.goal];
      const d = run(dijkstra(grid, { movement }));
      assert.equal(d.found, Number.isFinite(expected), `semilla ${seed}`);
      if (!d.found) continue;
      assert.ok(close(d.cost, expected), `Dijkstra semilla ${seed} ${movement}: ${d.cost} vs ${expected}`);
      for (const h of Object.keys(HEURISTICS)) {
        if (!isAdmissible(h, movement)) continue;
        const a = run(astar(grid, { movement, heuristic: h }));
        assert.ok(close(a.cost, expected), `A* ${h} semilla ${seed} ${movement}: ${a.cost} vs ${expected}`);
      }
      // BFS: mínimo número de movimientos.
      const unit = referenceCosts(grid, grid.start, movement, { unit: true });
      assert.equal(run(bfs(grid, { movement })).moves, unit[grid.goal]);
      // DFS: encuentra un camino válido, nunca más barato que el óptimo.
      const f = run(dfs(grid, { movement }));
      assert.equal(f.found, true);
      assert.ok(f.cost >= expected - 1e-9);
    }
  }
});

test('Heurísticas admisibles nunca sobreestiman el coste real restante', () => {
  for (let seed = 1; seed <= 6; seed++) {
    for (const movement of Object.values(MOVEMENT)) {
      const grid = generateRandomObstacles(10, 10, seed, { density: 0.2, terrain: true });
      const toGoal = referenceCosts(grid, grid.goal, movement, { reverse: true });
      for (const id of Object.keys(HEURISTICS)) {
        const h = makeHeuristicFn(grid, id, grid.goal, minCellCost(grid));
        let overestimates = 0;
        for (let i = 0; i < grid.walls.length; i++) {
          if (grid.walls[i] || !Number.isFinite(toGoal[i])) continue;
          if (h(i) > toGoal[i] + 1e-9) overestimates++;
        }
        if (isAdmissible(id, movement)) assert.equal(overestimates, 0, `${id} ${movement} semilla ${seed}`);
      }
    }
  }
  // Manhattan sobreestima con diagonales en un mapa vacío.
  const empty = createGrid(5, 5);
  const h = makeHeuristicFn(empty, 'manhattan', empty.goal, 1);
  assert.ok(h(0) > 4 * Math.SQRT2);
  assert.equal(isAdmissible('manhattan', MOVEMENT.DIAGONAL), false);
});

test('Movimiento diagonal: coste √2 y prohibido cortar esquinas', () => {
  const grid = createGrid(3, 3);
  const r = run(dijkstra(grid, { movement: MOVEMENT.DIAGONAL }));
  assert.ok(close(r.cost, 2 * Math.SQRT2));
  assert.equal(r.moves, 2);
  // Bloquear (1,0) impide el paso diagonal (0,0) -> (1,1).
  const g2 = createGrid(2, 2);
  g2.walls[toIndex(g2, 1, 0)] = 1;
  const n = neighbors(g2, 0, MOVEMENT.DIAGONAL).map((x) => x.index);
  assert.ok(!n.includes(toIndex(g2, 1, 1)), 'no se corta la esquina');
  const r2 = run(astar(g2, { movement: MOVEMENT.DIAGONAL, heuristic: 'octile' }));
  assert.deepEqual(r2.path, [0, 2, 3]);
  // Escenario de esquinas: el camino no contiene pasos diagonales junto a muros.
  const corner = SCENARIOS.find((s) => s.id === 'corner').build();
  const rc = run(dijkstra(corner, { movement: MOVEMENT.DIAGONAL }));
  assert.doesNotThrow(() => measurePath(corner, rc.path, MOVEMENT.DIAGONAL));
  assert.throws(() => measurePath(g2, [0, 3], MOVEMENT.DIAGONAL), /no permitido/);
});

test('Reconstrucción del camino: consecutivo, del origen al destino, coste recalculado', () => {
  const grid = generateMaze(21, 21, 3);
  for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
    const r = run(algo.run(grid));
    assert.equal(r.path[0], grid.start);
    assert.equal(r.path.at(-1), grid.goal);
    const m = measurePath(grid, r.path);
    assert.ok(close(m.cost, r.cost));
    assert.equal(new Set(r.path).size, r.path.length, 'sin ciclos');
  }
  // En un laberinto perfecto el camino simple es único: todos coinciden.
  const costs = Object.values(PATHFINDING_ALGORITHMS).map((a) => run(a.run(grid)).cost);
  assert.ok(costs.every((c) => c === costs[0]));
});

test('Trazas: las métricas son coherentes con los eventos emitidos', () => {
  const grid = SCENARIOS.find((s) => s.id === 'wall-gap').build();
  for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
    const { result, events } = runCollect(algo.run(grid));
    assert.equal(events.filter((e) => e.type === 'expand').length, result.metrics.expanded, algo.id);
    assert.equal(events.filter((e) => e.type === 'discover').length, result.metrics.discovered, algo.id);
    const traced = result;
    const silent = run(algo.run(grid, { trace: false }));
    assert.deepEqual(silent.path, traced.path, 'la traza no altera el resultado');
    assert.deepEqual(silent.metrics, traced.metrics);
  }
});
