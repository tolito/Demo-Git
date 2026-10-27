import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSP_PRESETS, arcConsistency, solveCSP } from '../src/algorithms/csp/solver.js';
import { createCSP, notEqual, binaryConstraint, verifySolution } from '../src/algorithms/csp/csp.js';
import {
  AUSTRALIA, K4, TASK_CSP_IMPOSSIBLE, TASK_CSP_INSTANCE, graphColoringCSP, randomGraph, sudokuCSP, taskAssignmentCSP,
} from '../src/algorithms/csp/problems.js';
import { SUDOKU_EXAMPLES, countSolutions, parseSudoku } from '../src/algorithms/backtracking/sudoku.js';
import { run, runCollect } from './helpers.js';

const allConfigs = [
  ...Object.values(CSP_PRESETS).map((p) => p.options),
  { mrv: false, degree: true, lcv: false, inference: 'none', ac3: false },
  { mrv: false, degree: false, lcv: true, inference: 'fc', ac3: true },
  { mrv: true, degree: false, lcv: false, inference: 'mac', ac3: false },
];

test('CSP consistente: Australia con 3 colores se resuelve con todas las configuraciones', () => {
  for (const options of allConfigs) {
    const csp = graphColoringCSP({ ...AUSTRALIA, colors: 3 });
    const r = run(solveCSP(csp, { ...options, trace: false }));
    assert.equal(r.solutionCount, 1);
    assert.ok(verifySolution(csp, r.solutions[0]).valid);
  }
  // Número total de 3-coloraciones de Australia: 6 para el continente × 3 para Tasmania = 18.
  const all = run(solveCSP(graphColoringCSP({ ...AUSTRALIA, colors: 3 }), { maxSolutions: Infinity, trace: false }));
  assert.equal(all.solutionCount, 18);
  assert.equal(all.exhausted, true);
});

test('CSP inconsistente: K4 con 3 colores no tiene solución aunque sea arco-consistente', () => {
  for (const options of allConfigs) {
    const r = run(solveCSP(graphColoringCSP({ ...K4, colors: 3 }), { ...options, trace: false }));
    assert.equal(r.solutionCount, 0);
    assert.equal(r.exhausted, true);
  }
  const ac = run(arcConsistency(graphColoringCSP({ ...K4, colors: 3 }), { trace: false }));
  assert.equal(ac.consistent, true, 'AC-3 por sí solo no detecta esta inconsistencia');
  // Con 2 colores un triángulo sí es detectado por la búsqueda, y un dominio vacío por AC-3.
  const tiny = createCSP({ variables: ['x', 'y'], domains: { x: [1], y: [1] }, constraints: [notEqual('x', 'y')] });
  const r = run(arcConsistency(tiny, { trace: false }));
  assert.equal(r.consistent, false);
  const solved = run(solveCSP(tiny, { ac3: true, trace: false }));
  assert.equal(solved.inconsistentBeforeSearch, true);
  assert.equal(solved.solutionCount, 0);
});

test('Todas las configuraciones encuentran el mismo número de soluciones', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const g = randomGraph(seed, { nodes: 8, neighbors: 2 });
    const counts = allConfigs.map((options) => run(solveCSP(graphColoringCSP({ ...g, colors: 3 }), { ...options, maxSolutions: Infinity, trace: false })).solutionCount);
    assert.ok(counts.every((c) => c === counts[0]), `semilla ${seed}: ${counts}`);
  }
});

test('Forward checking: tras cada asignación, los dominios de los vecinos son compatibles', () => {
  const csp = graphColoringCSP({ ...AUSTRALIA, colors: 3 });
  const { events } = runCollect(solveCSP(csp, { inference: 'fc', mrv: true }));
  // Reproducir dominios y asignaciones con los eventos.
  const domains = new Map(csp.variables.map((v) => [v, new Set(csp.domains.get(v))]));
  const assignment = new Map();
  for (const e of events) {
    if (e.type === 'assign') assignment.set(e.data.variable, e.data.value);
    if (e.type === 'backtrack') assignment.delete(e.data.variable);
    if (e.type === 'prune') for (const v of e.data.removed) domains.get(e.data.variable).delete(v);
    if (e.type === 'restore') for (const [v, x] of e.data.restored) domains.get(v).add(x);
    if (e.type === 'prune') {
      // El valor podado debe ser exactamente el del vecino asignado (restricción ≠).
      assert.ok(e.data.removed.every((x) => x === assignment.get(e.data.cause)));
    }
    if (e.type === 'select-variable') {
      // Ningún valor restante de una variable libre choca con un vecino asignado.
      for (const v of csp.variables) {
        if (assignment.has(v)) continue;
        for (const w of csp.neighborsOf(v)) {
          if (assignment.has(w)) assert.ok(!domains.get(v).has(assignment.get(w)), `${v} conserva el color de ${w}`);
        }
      }
    }
  }
});

test('AC-3: el resultado es arco-consistente y no elimina valores de ninguna solución', () => {
  const board = parseSudoku(SUDOKU_EXAMPLES.find((e) => e.id === 'hard').board);
  const csp = sudokuCSP(board);
  const r = run(arcConsistency(csp, { trace: false }));
  assert.equal(r.consistent, true);
  // Arco-consistencia: todo valor tiene soporte en cada vecino binario.
  for (const xi of csp.variables) {
    for (const xj of csp.binaryNeighbors(xi)) {
      const preds = csp.binaryPredicates(xi, xj);
      for (const x of r.domains.get(xi)) {
        assert.ok(r.domains.get(xj).some((y) => preds.every((p) => p(x, y))), `${xi}=${x} sin soporte en ${xj}`);
      }
    }
  }
  // La solución única sigue dentro de los dominios reducidos.
  const solution = countSolutions(board, 1).solutions[0];
  csp.variables.forEach((v, i) => assert.ok(r.domains.get(v).includes(solution[i])));
});

test('Sudoku como CSP: la solución coincide con la del backtracking', () => {
  const board = parseSudoku(SUDOKU_EXAMPLES.find((e) => e.id === 'easy').board);
  const expected = countSolutions(board, 1).solutions[0];
  for (const preset of ['fc', 'mac']) {
    const csp = sudokuCSP(board);
    const r = run(solveCSP(csp, { ...CSP_PRESETS[preset].options, trace: false }));
    assert.equal(r.solutionCount, 1);
    assert.ok(verifySolution(csp, r.solutions[0]).valid);
    csp.variables.forEach((v, i) => assert.equal(r.solutions[0][v], expected[i]));
  }
  const multi = run(solveCSP(sudokuCSP(parseSudoku(SUDOKU_EXAMPLES.find((e) => e.id === 'multiple').board)), { ...CSP_PRESETS.mac.options, maxSolutions: 10, trace: false }));
  assert.equal(multi.solutionCount, 2);
});

test('Asignación de tareas como CSP: con y sin solución, restricciones n-arias respetadas', () => {
  for (const preset of Object.values(CSP_PRESETS)) {
    const csp = taskAssignmentCSP(TASK_CSP_INSTANCE);
    const r = run(solveCSP(csp, { ...preset.options, maxSolutions: Infinity, trace: false }));
    assert.ok(r.solutionCount > 0);
    for (const s of r.solutions) {
      assert.ok(verifySolution(csp, s).valid);
      const load = {};
      for (const a of Object.values(s)) load[a] = (load[a] ?? 0) + 1;
      for (const agent of TASK_CSP_INSTANCE.agents) assert.ok((load[agent.id] ?? 0) <= agent.capacity);
      assert.equal(s.t1, s.t4, 'tareas que deben ir juntas');
    }
    const none = run(solveCSP(taskAssignmentCSP(TASK_CSP_IMPOSSIBLE), { ...preset.options, trace: false }));
    assert.equal(none.solutionCount, 0, preset.id);
    assert.equal(none.exhausted, true);
  }
});

test('Validación del modelo y de soluciones', () => {
  assert.throws(() => createCSP({ variables: ['a', 'a'], domains: { a: [1] } }), /repetidas/);
  assert.throws(() => createCSP({ variables: ['a'], domains: {} }), /dominio/);
  assert.throws(() => binaryConstraint('a', 'a', () => true), /distintas/);
  const csp = graphColoringCSP({ ...AUSTRALIA, colors: 3 });
  assert.equal(verifySolution(csp, { WA: 0, NT: 0, SA: 1, Q: 0, NSW: 2, V: 0, T: 0 }).valid, false);
  assert.equal(verifySolution(csp, { WA: 0 }).valid, false);
});

test('Límite de nodos: la búsqueda se detiene e informa', () => {
  const g = randomGraph(3, { nodes: 20 });
  const r = run(solveCSP(graphColoringCSP({ ...g, colors: 3 }), { maxNodes: 50, trace: false }));
  assert.equal(r.limitReached, true);
  assert.equal(r.exhausted, false);
});
