import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUDOKU_EXAMPLES, countSolutions, generateSudoku, isSolved, parseSudoku, solveSudoku, validateSudoku,
} from '../src/algorithms/backtracking/sudoku.js';
import { KNOWN_SOLUTION_COUNTS, countNQueens, isValidQueens, solveNQueens } from '../src/algorithms/backtracking/nqueens.js';
import {
  DEFAULT_INSTANCE, isValidAssignment, randomInstance, solveTaskAssignment,
} from '../src/algorithms/backtracking/task-assignment.js';
import { backtrackingSearch } from '../src/algorithms/backtracking/engine.js';
import { run, runCollect } from './helpers.js';

const example = (id) => parseSudoku(SUDOKU_EXAMPLES.find((e) => e.id === id).board);

test('Sudoku: resuelve los ejemplos y la solución respeta pistas y reglas', () => {
  for (const id of ['easy', 'hard']) {
    const board = example(id);
    for (const order of ['static', 'mrv']) {
      if (id === 'hard' && order === 'static') continue; // demasiado lento sin MRV
      const r = run(solveSudoku(board, { variableOrder: order, trace: false }));
      const solved = r.solvedBoards[0];
      assert.ok(isSolved(solved), `${id} ${order}`);
      board.forEach((v, i) => { if (v) assert.equal(solved[i], v); });
    }
  }
});

test('Sudoku: un tablero ya resuelto es válido y tiene exactamente una solución', () => {
  const solved = run(solveSudoku(example('easy'), { trace: false })).solvedBoards[0];
  assert.ok(isSolved(solved));
  assert.equal(countSolutions(solved, 2).count, 1);
});

test('Sudoku inválido: se detectan las pistas repetidas y no se intenta resolver', () => {
  const board = example('invalid');
  const v = validateSudoku(board);
  assert.equal(v.valid, false);
  assert.match(v.errors[0].message, /repiten/);
  assert.throws(() => run(solveSudoku(board)), /inválido/);
  assert.throws(() => parseSudoku('123'), /81 celdas/);
  const unsolvable = example('unsolvable');
  assert.equal(validateSudoku(unsolvable).valid, true);
  assert.equal(countSolutions(unsolvable, 2).count, 0);
});

test('Sudoku con múltiples soluciones: se cuentan exactamente', () => {
  const r = countSolutions(example('multiple'), 10);
  assert.equal(r.count, 2);
  assert.equal(r.complete, true);
  assert.notDeepEqual(r.solutions[0], r.solutions[1]);
  assert.equal(countSolutions(example('easy'), 2).count, 1);
  assert.equal(countSolutions(example('hard'), 2).count, 1);
  // Tablero vacío: al menos 2 soluciones (la búsqueda se detiene en el límite).
  const empty = countSolutions(new Array(81).fill(0), 2);
  assert.equal(empty.count, 2);
  assert.equal(empty.complete, false);
});

test('Sudoku generado: solución única verificada y reproducible por semilla', () => {
  const a = generateSudoku(11, { targetClues: 30 });
  const b = generateSudoku(11, { targetClues: 30 });
  assert.deepEqual(a.puzzle, b.puzzle);
  assert.equal(countSolutions(a.puzzle, 2).count, 1);
  assert.ok(isSolved(a.solution));
  a.puzzle.forEach((v, i) => { if (v) assert.equal(v, a.solution[i]); });
  assert.ok(a.clues >= 30);
});

test('N reinas: número de soluciones conocido para n = 1..9', () => {
  for (let n = 1; n <= 9; n++) assert.equal(countNQueens(n), KNOWN_SOLUTION_COUNTS[n], `n = ${n}`);
});

test('N reinas: las soluciones son válidas, también con MRV, y se detectan tamaños sin solución', () => {
  for (const order of ['static', 'mrv']) {
    const r = run(solveNQueens(8, { mode: 'all', variableOrder: order, trace: false }));
    assert.equal(r.solutionCount, 92);
    for (const s of r.solutions) assert.ok(isValidQueens(Array.from({ length: 8 }, (_, i) => s[i])));
  }
  for (const n of [2, 3]) {
    const { result, events } = runCollect(solveNQueens(n, { mode: 'all' }));
    assert.equal(result.solutionCount, 0);
    assert.equal(result.complete, true);
    assert.match(events.at(-1).message, /no existe ninguna solución/);
  }
});

test('Motor: secuencia de eventos de backtracking y deshacer asignaciones', () => {
  const { result, events } = runCollect(solveNQueens(4, { mode: 'first' }));
  const types = new Set(events.map((e) => e.type));
  for (const t of ['select-variable', 'try-candidate', 'check', 'conflict', 'assign', 'advance', 'backtrack', 'solution']) {
    assert.ok(types.has(t), `falta el evento ${t}`);
  }
  // Reproducir asignaciones y retrocesos debe dejar exactamente la solución.
  const assignment = new Map();
  for (const e of events) {
    if (e.type === 'assign') assignment.set(e.data.variable, e.data.value);
    if (e.type === 'backtrack') assignment.delete(e.data.variable);
  }
  assert.deepEqual(Object.fromEntries(assignment), result.solutions[0]);
  assert.equal(result.solutions.length, 1);
});

test('Motor: detener la búsqueda (cerrar el generador) no lanza errores', () => {
  const gen = solveNQueens(12, { mode: 'all' });
  for (let i = 0; i < 1000; i++) gen.next();
  const closed = gen.return(undefined);
  assert.equal(closed.done, true);
});

test('Asignación de tareas: ambas estrategias son exactas y la mejorada explora menos', () => {
  const simple = run(solveTaskAssignment(DEFAULT_INSTANCE, { strategy: 'simple', trace: false }));
  const improved = run(solveTaskAssignment(DEFAULT_INSTANCE, { strategy: 'improved', trace: false }));
  assert.equal(simple.bestCost, improved.bestCost);
  assert.equal(simple.bestCost, 17);
  assert.ok(isValidAssignment(DEFAULT_INSTANCE, simple.best));
  assert.ok(isValidAssignment(DEFAULT_INSTANCE, improved.best));
  assert.ok(improved.metrics.nodes < simple.metrics.nodes);
});

test('Asignación de tareas: coincide con fuerza bruta en instancias aleatorias', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const inst = randomInstance(seed, { agents: 3, tasks: 5 });
    // Fuerza bruta: todas las asignaciones agente^tareas.
    let best = Infinity;
    const ids = inst.agents.map((a) => a.id);
    const total = ids.length ** inst.tasks.length;
    for (let code = 0; code < total; code++) {
      const asg = {};
      let c = code;
      for (const t of inst.tasks) { asg[t.id] = ids[c % ids.length]; c = Math.floor(c / ids.length); }
      if (isValidAssignment(inst, asg)) best = Math.min(best, inst.tasks.reduce((s, t) => s + inst.cost[t.id][asg[t.id]], 0));
    }
    for (const strategy of ['simple', 'improved']) {
      const r = run(solveTaskAssignment(inst, { strategy, trace: false }));
      assert.equal(r.bestCost ?? Infinity, best, `semilla ${seed} ${strategy}`);
    }
  }
});

test('Motor genérico: modo optimize sin solución devuelve best = null', () => {
  const problem = {
    variables: ['a'],
    values: () => [1, 2],
    check: () => ({ reason: 'siempre falla', conflicts: [] }),
    cost: () => 0,
  };
  const r = run(backtrackingSearch(problem, { mode: 'optimize', trace: false }));
  assert.equal(r.best, null);
  assert.equal(r.bestCost, null);
});
