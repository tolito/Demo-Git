import { createRng } from '../../core/rng.js';
import { makeEvent } from '../../core/trace.js';

/**
 * Minimax y poda alfa-beta sobre una interfaz de juego genérica:
 *   isTerminal(s), legalMoves(s), applyMove(s, m), utility(s) (exacta, desde
 *   el punto de vista de MAX), evaluate(s) (heurística), isMaxTurn(s),
 *   moveLabel(m, s) y, opcionalmente, orderMovesHeuristic / orderMovesOracle.
 *
 * Opciones:
 *   alphaBeta: activar la poda.
 *   depthLimit: profundidad máxima (Infinity = hasta estados terminales).
 *   ordering: 'natural' | 'reverse' | 'random' | 'heuristic' | 'oracle'.
 *   seed: semilla del orden aleatorio.
 *   trace: emitir eventos.
 *
 * Valores:
 *   - En hojas terminales se usa la utilidad exacta.
 *   - Si se corta por profundidad se usa la evaluación heurística y el valor se
 *     marca como heurístico (exact = false) en todo el camino hasta la raíz.
 *   - Con alfa-beta, el valor de un nodo en el que se produce una poda es solo
 *     una cota (>= v en MAX, <= v en MIN); el valor de la raíz es exacto.
 */
export function* gameTreeSearch(game, rootState, options = {}) {
  const {
    alphaBeta = false,
    depthLimit = Infinity,
    ordering = 'natural',
    seed = 1,
    trace = true,
  } = options;
  if (game.isTerminal(rootState)) {
    throw new Error('El estado raíz es terminal: no hay jugadas que analizar.');
  }
  const rng = createRng(seed);
  const metrics = { visited: 0, leaves: 0, terminalLeaves: 0, heuristicLeaves: 0, cutoffs: 0, prunedBranches: 0, maxDepth: 0 };
  let nextId = 0;

  function order(state, moves) {
    switch (ordering) {
      case 'natural': return moves;
      case 'reverse': return moves.slice().reverse();
      case 'random': return rng.shuffle(moves.slice());
      case 'heuristic':
        if (!game.orderMovesHeuristic) throw new Error('Este juego no define un orden heurístico.');
        return game.orderMovesHeuristic(state, moves);
      case 'oracle':
        if (!game.orderMovesOracle) throw new Error('El orden oráculo solo existe en el árbol sintético.');
        return game.orderMovesOracle(state, moves);
      default: throw new Error(`Orden desconocido: ${ordering}`);
    }
  }

  const fmt = (v) => (v === Infinity ? '+∞' : v === -Infinity ? '−∞' : String(v));

  function* visit(state, depth, alpha, beta, parentId, move) {
    const id = nextId++;
    const isMax = game.isMaxTurn(state);
    metrics.visited++;
    if (depth > metrics.maxDepth) metrics.maxDepth = depth;
    if (trace) {
      yield makeEvent('enter', `Se visita el nodo ${id} (${isMax ? 'MAX' : 'MIN'}, profundidad ${depth})${move !== null ? ` tras la jugada ${game.moveLabel(move)}` : ''}${alphaBeta ? ` con α = ${fmt(alpha)}, β = ${fmt(beta)}` : ''}.`,
        { id, parentId, move, moveLabel: move !== null ? game.moveLabel(move) : null, depth, isMax, alpha, beta, state }, metrics);
    }
    if (game.isTerminal(state)) {
      const value = game.utility(state);
      metrics.leaves++;
      metrics.terminalLeaves++;
      if (trace) yield makeEvent('leaf', `Nodo ${id} terminal: utilidad exacta ${value}.`, { id, value, exact: true }, metrics);
      return { value, exact: true, bestMove: null, id };
    }
    if (depth >= depthLimit) {
      const value = game.evaluate(state);
      metrics.leaves++;
      metrics.heuristicLeaves++;
      if (trace) yield makeEvent('leaf', `Nodo ${id} en el límite de profundidad: evaluación heurística ${value} (no es un valor exacto).`, { id, value, exact: false }, metrics);
      return { value, exact: false, bestMove: null, id };
    }

    const moves = order(state, game.legalMoves(state));
    let best = isMax ? -Infinity : Infinity;
    let bestMove = null;
    let exact = true;
    let a = alpha;
    let b = beta;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const child = yield* visit(game.applyMove(state, m), depth + 1, a, b, id, m);
      if (!child.exact) exact = false;
      const improves = isMax ? child.value > best : child.value < best;
      if (improves) {
        best = child.value;
        bestMove = m;
      }
      if (alphaBeta) {
        if (isMax) a = Math.max(a, best);
        else b = Math.min(b, best);
      }
      if (trace) {
        yield makeEvent('update',
          `Nodo ${id} (${isMax ? 'MAX' : 'MIN'}) recibe ${child.value} de la jugada ${game.moveLabel(m)}; mejor valor actual ${fmt(best)}${improves ? ' (mejora)' : ''}${alphaBeta ? `; α = ${fmt(a)}, β = ${fmt(b)}` : ''}.`,
          { id, childId: child.id, value: best, alpha: a, beta: b, bestMove, improves }, metrics);
      }
      if (alphaBeta && a >= b && i < moves.length - 1) {
        const pruned = moves.slice(i + 1);
        metrics.cutoffs++;
        metrics.prunedBranches += pruned.length;
        if (trace) {
          yield makeEvent('prune',
            `Poda en el nodo ${id}: α = ${fmt(a)} ≥ β = ${fmt(b)}. ${isMax ? 'MIN' : 'MAX'} nunca permitirá llegar aquí, se descartan ${pruned.length} rama(s): ${pruned.map((p) => game.moveLabel(p)).join(', ')}.`,
            { id, prunedMoves: pruned, prunedLabels: pruned.map((p) => game.moveLabel(p)), alpha: a, beta: b, bound: isMax ? 'lower' : 'upper' }, metrics);
        }
        if (trace) yield makeEvent('exit', `Nodo ${id} devuelve ${best} (cota ${isMax ? 'inferior: ≥' : 'superior: ≤'} ${best}, tras la poda).`, { id, value: best, bestMove, exact, bound: isMax ? 'lower' : 'upper' }, metrics);
        return { value: best, exact, bestMove, id };
      }
    }
    if (trace) yield makeEvent('exit', `Nodo ${id} devuelve ${best}${exact ? '' : ' (incluye evaluaciones heurísticas)'}.`, { id, value: best, bestMove, exact, bound: null }, metrics);
    return { value: best, exact, bestMove, id };
  }

  const root = yield* visit(rootState, 0, -Infinity, Infinity, null, null);
  if (trace) {
    yield makeEvent('choose', `Jugada elegida en la raíz: ${game.moveLabel(root.bestMove, rootState)} con valor ${root.value}${root.exact ? ' (exacto)' : ' (estimado con heurística)'}.`,
      { id: root.id, bestMove: root.bestMove, value: root.value, exact: root.exact }, metrics);
  }
  return {
    value: root.value,
    exact: root.exact,
    bestMove: root.bestMove,
    algorithm: alphaBeta ? 'alphabeta' : 'minimax',
    metrics: { ...metrics },
  };
}

/** Valor minimax exacto de cada jugada legal (sin poda), útil para comparar jugadas. */
export function moveValues(game, state, { depthLimit = Infinity } = {}) {
  const values = [];
  for (const m of game.legalMoves(state)) {
    const next = game.applyMove(state, m);
    if (game.isTerminal(next)) {
      values.push({ move: m, value: game.utility(next) });
      continue;
    }
    const gen = gameTreeSearch(game, next, { depthLimit: depthLimit - 1, trace: false });
    let step = gen.next();
    while (!step.done) step = gen.next();
    values.push({ move: m, value: step.value.value });
  }
  return values;
}
