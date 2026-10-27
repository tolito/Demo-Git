import { createRng } from '../../core/rng.js';

/**
 * Árbol de juego sintético configurable para estudiar minimax y alfa-beta.
 *
 * Árbol uniforme de factor de ramificación `branching` y profundidad `depth`.
 * La raíz es MAX y los niveles alternan. Las hojas tienen valores enteros
 * (aleatorios con semilla o introducidos por el usuario en orden de izquierda
 * a derecha). Un estado es el camino de jugadas desde la raíz.
 */
export function createSyntheticTree({ branching = 3, depth = 3, seed = 1, leaves = null, min = -9, max = 9 } = {}) {
  if (!Number.isInteger(branching) || branching < 2 || branching > 5) throw new RangeError('La ramificación debe estar entre 2 y 5.');
  if (!Number.isInteger(depth) || depth < 1 || depth > 7) throw new RangeError('La profundidad debe estar entre 1 y 7.');
  const leafCount = branching ** depth;
  let values;
  if (leaves) {
    if (leaves.length !== leafCount) throw new Error(`Se necesitan ${leafCount} valores de hoja (${branching}^${depth}); se han dado ${leaves.length}.`);
    if (leaves.some((v) => !Number.isFinite(v))) throw new Error('Todos los valores de hoja deben ser números.');
    values = leaves.slice();
  } else {
    const rng = createRng(seed);
    values = Array.from({ length: leafCount }, () => rng.int(min, max));
  }

  const leafIndex = (path) => path.reduce((acc, m) => acc * branching + m, 0);
  const moves = Array.from({ length: branching }, (_, i) => i);

  const game = {
    id: 'synthetic',
    name: `Árbol sintético b=${branching}, d=${depth}`,
    branching,
    depth,
    leaves: values,
    initialState: { path: [] },
    isTerminal: (state) => state.path.length === depth,
    legalMoves: (state) => (state.path.length === depth ? [] : moves),
    applyMove(state, move) {
      if (state.path.length >= depth) throw new Error('No hay jugadas desde una hoja.');
      if (!moves.includes(move)) throw new Error(`Jugada ilegal: ${move}`);
      return { path: [...state.path, move] };
    },
    utility: (state) => values[leafIndex(state.path)],
    // En el árbol sintético no hay evaluación heurística con significado: si se
    // corta antes de las hojas se usa 0 y se marca como heurística.
    evaluate: () => 0,
    isMaxTurn: (state) => state.path.length % 2 === 0,
    moveLabel: (move) => String.fromCharCode(97 + move),
  };

  /**
   * Orden "oráculo": usa el valor minimax exacto de cada hijo, que solo puede
   * conocerse en un árbol sintético. Sirve para mostrar el mejor caso teórico de
   * alfa-beta (aprox. b^(d/2) hojas), no es una heurística realista.
   */
  const exactValues = new Map();
  const exact = (state) => {
    const key = state.path.join(',');
    if (exactValues.has(key)) return exactValues.get(key);
    let v;
    if (game.isTerminal(state)) v = game.utility(state);
    else {
      const children = moves.map((m) => exact(game.applyMove(state, m)));
      v = game.isMaxTurn(state) ? Math.max(...children) : Math.min(...children);
    }
    exactValues.set(key, v);
    return v;
  };
  game.orderMovesOracle = (state, list) => {
    const max = game.isMaxTurn(state);
    return list.slice().sort((a, b) => {
      const va = exact(game.applyMove(state, a));
      const vb = exact(game.applyMove(state, b));
      return max ? vb - va : va - vb;
    });
  };
  return game;
}

/** Ejemplo de libro (Russell y Norvig, fig. 5.2): b=3, d=2, valor 3. */
export const TEXTBOOK_TREE = Object.freeze({ branching: 3, depth: 2, leaves: [3, 12, 8, 2, 4, 6, 14, 5, 2] });
