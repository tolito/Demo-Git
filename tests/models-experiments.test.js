import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionController } from '../src/core/execution-controller.js';
import { SCENARIOS } from '../src/algorithms/pathfinding/maps.js';
import { astar, dfs } from '../src/algorithms/pathfinding/search.js';
import { solveNQueens } from '../src/algorithms/backtracking/nqueens.js';
import { solveCSP, CSP_PRESETS } from '../src/algorithms/csp/solver.js';
import { AUSTRALIA, graphColoringCSP } from '../src/algorithms/csp/problems.js';
import { TEXTBOOK_TREE, createSyntheticTree } from '../src/algorithms/game-theory/synthetic-tree.js';
import { gameTreeSearch } from '../src/algorithms/game-theory/search.js';
import { geneticAlgorithm } from '../src/algorithms/genetic/engine.js';
import { functionProblem } from '../src/algorithms/genetic/problems.js';
import {
  CELL, backtrackingModel, cspModel, gameTreeModel, geneticModel, pathfindingModel,
} from '../src/visualization/models.js';
import { EXPERIMENTS, getExperiment, normalizeParams } from '../src/experiments/definitions.js';
import { aggregate, runExperiment } from '../src/experiments/runner.js';
import { toCSV, toJSON } from '../src/utils/export.js';
import { summarize } from '../src/utils/stats.js';
import { fakeScheduler } from './helpers.js';

/** Serializa el estado de un modelo para comparar estados obtenidos por caminos distintos. */
function snapshot(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Map) return [...v.entries()];
    if (v instanceof Set) return [...v].sort();
    if (ArrayBuffer.isView(v)) return Array.from(v, (x) => (Number.isNaN(x) ? 'NaN' : x));
    return v;
  });
}

const cases = [
  ['caminos A*', () => { const g = SCENARIOS[1].build(); return { createRun: () => astar(g), model: pathfindingModel(g) }; }],
  ['caminos DFS', () => { const g = SCENARIOS[3].build(); return { createRun: () => dfs(g), model: pathfindingModel(g) }; }],
  ['backtracking', () => ({ createRun: () => solveNQueens(6, { mode: 'all' }), model: backtrackingModel() })],
  ['CSP', () => { const c = graphColoringCSP({ ...AUSTRALIA, colors: 3 }); return { createRun: () => solveCSP(c, { ...CSP_PRESETS.mac.options, maxSolutions: 5 }), model: cspModel(c) }; }],
  ['árbol', () => { const g = createSyntheticTree(TEXTBOOK_TREE); return { createRun: () => gameTreeSearch(g, g.initialState, { alphaBeta: true }), model: gameTreeModel() }; }],
  ['genético', () => ({ createRun: () => geneticAlgorithm(functionProblem(), { maxGenerations: 30 }), model: geneticModel() })],
];

for (const [name, build] of cases) {
  test(`Modelo ${name}: retroceder con puntos de control equivale a reproducir desde cero`, () => {
    const { createRun, model } = build();
    const c = new ExecutionController({ createRun, model, checkpointInterval: 13, scheduler: fakeScheduler() });
    c.runToEndSync();
    const total = c.position;
    assert.ok(total > 20);
    const targets = [total - 1, Math.floor(total / 2), 14, 13, 1, 0, Math.floor(total * 0.9)];
    for (const target of targets) {
      c.goTo(target);
      const reference = new ExecutionController({ createRun, model, scheduler: fakeScheduler() });
      reference.goTo(target);
      assert.equal(snapshot(c.state), snapshot(reference.state), `${name} paso ${target}`);
    }
  });
}

test('Modelo de caminos: el estado final refleja camino y celdas expandidas', () => {
  const g = SCENARIOS[1].build();
  const c = new ExecutionController({ createRun: () => astar(g), model: pathfindingModel(g), scheduler: fakeScheduler() });
  c.runToEndSync();
  assert.deepEqual(c.state.path, c.result.path);
  const expanded = c.state.cells.filter((x) => x === CELL.VISITED).length;
  assert.equal(expanded, c.result.metrics.expanded);
});

test('Estadística: media, desviación típica muestral y valores no válidos', () => {
  const s = summarize([2, 4, 4, 4, 5, 5, 7, 9, NaN, Infinity]);
  assert.equal(s.n, 8);
  assert.equal(s.mean, 5);
  assert.ok(Math.abs(s.std - 2.13808993529939) < 1e-12);
  assert.equal(s.median, 4.5);
  assert.equal(summarize([3]).std, 0);
  assert.ok(Number.isNaN(summarize([]).mean));
});

test('Exportación CSV y JSON', () => {
  const csv = toCSV([{ a: 1, b: 'x,y' }, { a: Infinity, b: 'comillas "z"' }]);
  assert.equal(csv, 'a,b\n1,"x,y"\nInfinity,"comillas ""z"""');
  assert.equal(JSON.parse(toJSON({ v: Infinity })).v, 'Infinity');
});

test('Parámetros de experimentos: validación', () => {
  const def = getExperiment('pathfinding');
  assert.throws(() => normalizeParams(def, { size: 1000 }), /Lado/);
  assert.throws(() => normalizeParams(def, { movement: 'teletransporte' }), /Movimiento/);
  assert.equal(normalizeParams(def, {}).size, 40);
  assert.throws(() => getExperiment('nada'));
});

test('Experimentos: todos se ejecutan, son reproducibles y agregan por variante', async () => {
  const small = {
    pathfinding: { size: 12, runs: 3 },
    sudoku: { runs: 1, clues: 34 },
    csp: { nodes: 8, runs: 2 },
    games: { depth: 3, runs: 3 },
    genetic: { runs: 2, maxGenerations: 10, populationSize: 10 },
  };
  for (const def of EXPERIMENTS) {
    const params = small[def.id];
    const a = await runExperiment(def, params, { yieldFn: async () => {} });
    const b = await runExperiment(def, params, { yieldFn: async () => {} });
    const strip = (rows) => rows.map(({ timeMs, ...rest }) => rest);
    assert.deepEqual(strip(a.rows), strip(b.rows), `${def.id} reproducible (salvo tiempos)`);
    const agg = aggregate(a.rows, def.metrics);
    assert.ok(agg.length >= 1);
    for (const g of agg) assert.equal(g.runs, a.params.runs, `${def.id}: una fila por repetición y variante`);
  }
});

test('Experimentos: las variantes de minimax coinciden en valor y se puede cancelar', async () => {
  const def = getExperiment('games');
  const r = await runExperiment(def, { runs: 5, depth: 4 }, { yieldFn: async () => {} });
  assert.ok(r.rows.every((row) => row.valueMatches === 1));
  const token = { cancelled: false };
  const partial = await runExperiment(def, { runs: 50, depth: 3 }, {
    token,
    yieldFn: async () => {},
    onProgress: (done) => { if (done === 2) token.cancelled = true; },
  });
  assert.equal(partial.cancelled, true);
  assert.equal(new Set(partial.rows.map((x) => x.run)).size, 2);
});
