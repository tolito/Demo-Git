import { runToCompletion } from '../../core/trace.js';
import { backtrackingSearch } from './engine.js';

/**
 * N reinas: variable = fila, valor = columna. Restricciones: dos reinas no
 * comparten columna ni diagonal (las filas son distintas por construcción).
 */

export const MAX_QUEENS = 20;

/** Número de soluciones conocido (OEIS A000170) para validar el motor. */
export const KNOWN_SOLUTION_COUNTS = Object.freeze([1, 1, 0, 0, 2, 10, 4, 40, 92, 352, 724, 2680, 14200]);

export function createNQueensProblem(n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUEENS) throw new RangeError(`n debe estar entre 1 y ${MAX_QUEENS}.`);
  const rows = Array.from({ length: n }, (_, i) => i);
  const columns = Array.from({ length: n }, (_, i) => i);
  // Columna asignada por fila (-1 = libre) para comprobar conflictos en O(n).
  const placed = new Int32Array(n).fill(-1);
  return {
    name: `${n} reinas`,
    variables: rows,
    values: () => columns,
    check(row, col) {
      const conflicts = [];
      let reason = null;
      for (let r = 0; r < n; r++) {
        const c = placed[r];
        if (c === -1 || r === row) continue;
        if (c === col) {
          conflicts.push(r);
          reason ??= `comparte columna con la reina de la fila ${r + 1}`;
        } else if (Math.abs(c - col) === Math.abs(r - row)) {
          conflicts.push(r);
          reason ??= `comparte diagonal con la reina de la fila ${r + 1}`;
        }
      }
      return conflicts.length ? { reason, conflicts } : null;
    },
    assign(row, col) { placed[row] = col; },
    unassign(row) { placed[row] = -1; },
    label: (row, col) => (col === undefined ? `fila ${row + 1}` : `reina en fila ${row + 1}, columna ${col + 1}`),
  };
}

export function* solveNQueens(n, { mode = 'first', maxSolutions, variableOrder = 'static', trace = true } = {}) {
  return yield* backtrackingSearch(createNQueensProblem(n), { mode, maxSolutions, variableOrder, trace });
}

export function countNQueens(n) {
  return runToCompletion(solveNQueens(n, { mode: 'all', trace: false })).result.solutionCount;
}

export function isValidQueens(columnsByRow) {
  const n = columnsByRow.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (columnsByRow[a] === columnsByRow[b]) return false;
      if (Math.abs(columnsByRow[a] - columnsByRow[b]) === b - a) return false;
    }
  }
  return true;
}
