import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, createState, evaluate, isTerminal, legalMoves, parseBoard, ticTacToe, utility, winner,
} from '../src/algorithms/game-theory/tictactoe.js';
import { TEXTBOOK_TREE, createSyntheticTree } from '../src/algorithms/game-theory/synthetic-tree.js';
import { gameTreeSearch, moveValues } from '../src/algorithms/game-theory/search.js';
import { createRng } from '../src/core/rng.js';
import { run, runCollect } from './helpers.js';

test('Tres en raya: estados terminales y detección de victorias, derrotas y empates', () => {
  const xWins = parseBoard('XXXOO....');
  assert.equal(winner(xWins), 'X');
  assert.ok(isTerminal(xWins));
  assert.equal(utility(xWins), 100 - 5);
  const oWins = parseBoard('XX.OOOX..');
  assert.equal(winner(oWins), 'O');
  assert.equal(utility(oWins), -(100 - 6));
  const draw = parseBoard('XOXXOOOXX');
  assert.equal(winner(draw), null);
  assert.ok(isTerminal(draw));
  assert.equal(utility(draw), 0);
  assert.ok(!isTerminal(createState()));
  assert.deepEqual(legalMoves(xWins), [], 'sin jugadas en estado terminal');
});

test('Tres en raya: movimientos legales y rechazo de ilegales o estados inconsistentes', () => {
  const s = parseBoard('X...O....');
  assert.deepEqual(legalMoves(s), [1, 2, 3, 5, 6, 7, 8]);
  assert.equal(s.toMove, 'X');
  const next = applyMove(s, 1);
  assert.equal(next.board[1], 'X');
  assert.equal(next.toMove, 'O');
  assert.equal(s.board[1], null, 'applyMove no muta el estado original');
  assert.throws(() => applyMove(s, 4), /ocupada/);
  assert.throws(() => applyMove(s, 9), /fuera/);
  assert.throws(() => applyMove(parseBoard('XXXOO....'), 5), /terminado/);
  assert.throws(() => parseBoard('XXX......'), /inconsistente/);
  assert.throws(() => parseBoard('OO.......'), /inconsistente/);
  assert.throws(() => parseBoard('XXXOOO...'), /inconsistente/);
  assert.throws(() => createState(Array(9).fill(null), 'O'), /Turno/);
});

test('Tres en raya: resultados conocidos', () => {
  // Árbol completo sin poda: 549 946 nodos (incluida la raíz); valor 0 (empate).
  const full = run(gameTreeSearch(ticTacToe, createState(), { trace: false }));
  assert.equal(full.value, 0);
  assert.equal(full.exact, true);
  assert.equal(full.metrics.visited, 549946);
  assert.equal(full.metrics.terminalLeaves, 255168, 'partidas posibles');
  // Ganar en una jugada.
  const win = run(gameTreeSearch(ticTacToe, parseBoard('XX.OO....'), { alphaBeta: true, trace: false }));
  assert.equal(win.bestMove, 2);
  assert.ok(win.value > 0);
  // Bloquear.
  const block = run(gameTreeSearch(ticTacToe, parseBoard('X..OO...X'), { alphaBeta: true, trace: false }));
  assert.equal(block.bestMove, 5);
  assert.equal(block.value, 0);
  // Esquinas opuestas: O debe jugar un lado para empatar.
  const vals = moveValues(ticTacToe, parseBoard('X...O...X'));
  for (const { move, value } of vals) {
    if ([1, 3, 5, 7].includes(move)) assert.equal(value, 0, `lado ${move}`);
    else assert.ok(value > 0, `esquina ${move} pierde`);
  }
});

test('Equivalencia minimax / alfa-beta: mismo valor y jugada óptima en posiciones aleatorias', () => {
  const rng = createRng(5);
  let checked = 0;
  for (let k = 0; k < 120; k++) {
    let s = createState();
    const plies = rng.int(1, 6);
    for (let p = 0; p < plies && !isTerminal(s); p++) s = applyMove(s, rng.pick(legalMoves(s)));
    if (isTerminal(s)) continue;
    for (const depthLimit of [Infinity, 2]) {
      for (const ordering of ['natural', 'reverse', 'random', 'heuristic']) {
        const mm = run(gameTreeSearch(ticTacToe, s, { depthLimit, ordering, seed: k, trace: false }));
        const ab = run(gameTreeSearch(ticTacToe, s, { depthLimit, ordering, seed: k, alphaBeta: true, trace: false }));
        assert.equal(ab.value, mm.value);
        assert.ok(ab.metrics.visited <= mm.metrics.visited);
        const values = moveValues(ticTacToe, s, { depthLimit });
        assert.equal(values.find((v) => v.move === ab.bestMove).value, mm.value, 'la jugada de alfa-beta es óptima');
        checked++;
      }
    }
  }
  assert.ok(checked > 500);
});

test('Árbol sintético: ejemplo de libro y poda válida', () => {
  const g = createSyntheticTree(TEXTBOOK_TREE);
  const mm = run(gameTreeSearch(g, g.initialState, { trace: false }));
  assert.equal(mm.value, 3);
  assert.equal(mm.bestMove, 0);
  const { result: ab, events } = runCollect(gameTreeSearch(g, g.initialState, { alphaBeta: true }));
  assert.equal(ab.value, 3);
  assert.equal(ab.metrics.prunedBranches, 2, 'el ejemplo clásico poda 2 hojas');
  const prune = events.find((e) => e.type === 'prune');
  assert.ok(prune.data.alpha >= prune.data.beta, 'solo se poda cuando α ≥ β');
  // Una poda es válida si cambiar los valores de las hojas podadas no altera el valor de la raíz.
  const leaves = TEXTBOOK_TREE.leaves.slice();
  leaves[4] = -100;
  leaves[5] = 100;
  const altered = createSyntheticTree({ ...TEXTBOOK_TREE, leaves });
  assert.equal(run(gameTreeSearch(altered, altered.initialState, { alphaBeta: true, trace: false })).value, 3);
});

test('Árbol sintético: alfa-beta = minimax con cualquier orden; orden oráculo alcanza el mejor caso', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const b = 2 + (seed % 3);
    const d = 2 + (seed % 4);
    const g = createSyntheticTree({ branching: b, depth: d, seed });
    const mm = run(gameTreeSearch(g, g.initialState, { trace: false }));
    for (const ordering of ['natural', 'reverse', 'random', 'oracle']) {
      const ab = run(gameTreeSearch(g, g.initialState, { alphaBeta: true, ordering, seed, trace: false }));
      assert.equal(ab.value, mm.value, `semilla ${seed} ${ordering}`);
      if (ordering === 'oracle') {
        const bestCase = b ** Math.ceil(d / 2) + b ** Math.floor(d / 2) - 1;
        assert.ok(ab.metrics.leaves <= bestCase, `semilla ${seed}: ${ab.metrics.leaves} > ${bestCase}`);
      }
    }
  }
});

test('Búsqueda limitada: valores heurísticos marcados y diferenciados de los exactos', () => {
  const s = createState();
  const r = run(gameTreeSearch(ticTacToe, s, { depthLimit: 2, trace: false }));
  assert.equal(r.exact, false);
  assert.ok(r.metrics.heuristicLeaves > 0);
  assert.ok(Math.abs(r.value) <= 24, 'una evaluación heurística nunca alcanza el rango de utilidades terminales');
  assert.equal(evaluate(parseBoard('X........')), 3, 'X en esquina abre 3 líneas');
  const { events } = runCollect(gameTreeSearch(ticTacToe, s, { depthLimit: 1 }));
  assert.ok(events.filter((e) => e.type === 'leaf').every((e) => e.data.exact === false));
  assert.throws(() => run(gameTreeSearch(ticTacToe, parseBoard('XXXOO....'))), /terminal/);
});
