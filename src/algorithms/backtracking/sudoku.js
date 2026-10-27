import { createRng } from '../../core/rng.js';
import { runToCompletion } from '../../core/trace.js';
import { backtrackingSearch } from './engine.js';

/**
 * Sudoku 9×9. El tablero es un array de 81 enteros (0 = vacío, 1..9 = valor),
 * en orden de filas. Las variables del problema de backtracking son los índices
 * de las celdas vacías; los valores, 1..9.
 */

export const SIZE = 9;
export const CELLS = 81;

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
export const cellName = (i) => `F${rowOf(i) + 1}C${colOf(i) + 1}`;

/** Celdas que comparten fila, columna o caja con la celda i (20 "pares"). */
export const PEERS = Array.from({ length: CELLS }, (_, i) => {
  const peers = [];
  for (let j = 0; j < CELLS; j++) {
    if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) peers.push(j);
  }
  return peers;
});

export function parseSudoku(text) {
  const chars = String(text).replace(/[^0-9.]/g, '');
  if (chars.length !== CELLS) throw new Error(`Un Sudoku necesita 81 celdas; se han encontrado ${chars.length}.`);
  return Array.from(chars, (c) => (c === '.' ? 0 : Number(c)));
}

export function formatSudoku(board) {
  return board.map((v) => (v ? String(v) : '.')).join('');
}

/**
 * Valida las reglas sobre las pistas: valores en 0..9 y sin repeticiones en
 * filas, columnas o cajas. No determina si el puzzle tiene solución.
 */
export function validateSudoku(board) {
  const errors = [];
  if (!Array.isArray(board) || board.length !== CELLS) {
    return { valid: false, errors: [{ message: 'El tablero debe tener 81 celdas.' }] };
  }
  board.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0 || v > 9) errors.push({ index: i, message: `Valor no válido en ${cellName(i)}.` });
  });
  for (let i = 0; i < CELLS; i++) {
    if (!board[i]) continue;
    for (const j of PEERS[i]) {
      if (j > i && board[j] === board[i]) {
        const unit = rowOf(i) === rowOf(j) ? 'fila' : colOf(i) === colOf(j) ? 'columna' : 'caja';
        errors.push({ index: i, other: j, message: `${cellName(i)} y ${cellName(j)} repiten el ${board[i]} en la misma ${unit}.` });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function isSolved(board) {
  return board.every((v) => v >= 1 && v <= 9) && validateSudoku(board).valid;
}

/**
 * Construye el problema de backtracking. Mantiene máscaras de bits por fila,
 * columna y caja que se actualizan al asignar y deshacer.
 */
export function createSudokuProblem(board, { rng = null } = {}) {
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  const values = board.slice();
  for (let i = 0; i < CELLS; i++) {
    if (values[i]) {
      const bit = 1 << values[i];
      rows[rowOf(i)] |= bit;
      cols[colOf(i)] |= bit;
      boxes[boxOf(i)] |= bit;
    }
  }
  const variables = [];
  for (let i = 0; i < CELLS; i++) if (!values[i]) variables.push(i);
  const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  function findPeerWith(i, value) {
    return PEERS[i].filter((j) => values[j] === value);
  }

  return {
    name: 'Sudoku',
    variables,
    values: () => DIGITS,
    check(i, value) {
      const bit = 1 << value;
      if (rows[rowOf(i)] & bit) return { reason: `repite el ${value} en la fila ${rowOf(i) + 1}`, conflicts: findPeerWith(i, value) };
      if (cols[colOf(i)] & bit) return { reason: `repite el ${value} en la columna ${colOf(i) + 1}`, conflicts: findPeerWith(i, value) };
      if (boxes[boxOf(i)] & bit) return { reason: `repite el ${value} en la caja ${boxOf(i) + 1}`, conflicts: findPeerWith(i, value) };
      return null;
    },
    assign(i, value) {
      const bit = 1 << value;
      values[i] = value;
      rows[rowOf(i)] |= bit;
      cols[colOf(i)] |= bit;
      boxes[boxOf(i)] |= bit;
    },
    unassign(i, value) {
      const bit = ~(1 << value);
      values[i] = 0;
      rows[rowOf(i)] &= bit;
      cols[colOf(i)] &= bit;
      boxes[boxOf(i)] &= bit;
    },
    // Con un generador aleatorio, los candidatos se barajan (solo para generar tableros).
    orderValues: rng ? (_v, vals) => rng.shuffle(vals.slice()) : undefined,
    label: (i, value) => (value === undefined ? cellName(i) : `${cellName(i)} = ${value}`),
  };
}

/** Generador de la resolución paso a paso. */
export function* solveSudoku(board, { variableOrder = 'mrv', mode = 'first', maxSolutions, trace = true } = {}) {
  const validation = validateSudoku(board);
  if (!validation.valid) {
    throw new Error(`Tablero inválido: ${validation.errors[0].message}`);
  }
  const result = yield* backtrackingSearch(createSudokuProblem(board), { mode, maxSolutions, variableOrder, trace });
  return { ...result, solvedBoards: result.solutions.map((s) => applySolution(board, s)) };
}

export function applySolution(board, assignment) {
  const out = board.slice();
  for (const [k, v] of Object.entries(assignment)) out[Number(k)] = v;
  return out;
}

/**
 * Cuenta soluciones hasta `limit` (2 basta para decidir la unicidad).
 * Devuelve { count, complete } donde complete indica si la búsqueda se agotó.
 */
export function countSolutions(board, limit = 2) {
  if (!validateSudoku(board).valid) return { count: 0, complete: true, invalid: true };
  const { result } = runToCompletion(backtrackingSearch(createSudokuProblem(board), {
    mode: 'all', maxSolutions: limit, variableOrder: 'mrv', trace: false, keepSolutions: limit,
  }));
  return { count: result.solutionCount, complete: result.complete, solutions: result.solutions.map((s) => applySolution(board, s)) };
}

/**
 * Genera un Sudoku con solución única verificada.
 * 1) Rellena un tablero completo con backtracking de valores barajados.
 * 2) Quita pistas en orden aleatorio; cada retirada se mantiene solo si el
 *    puzzle sigue teniendo exactamente una solución (comprobado contando hasta 2).
 */
export function generateSudoku(seed = 1, { targetClues = 30 } = {}) {
  const rng = createRng(seed);
  const empty = new Array(CELLS).fill(0);
  const { result } = runToCompletion(backtrackingSearch(createSudokuProblem(empty, { rng }), {
    mode: 'first', variableOrder: 'static', valueOrder: 'heuristic', trace: false,
  }));
  const solution = applySolution(empty, result.solutions[0]);
  const puzzle = solution.slice();
  const order = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  let clues = CELLS;
  let uniquenessChecks = 0;
  for (const i of order) {
    if (clues <= targetClues) break;
    const saved = puzzle[i];
    puzzle[i] = 0;
    uniquenessChecks++;
    if (countSolutions(puzzle, 2).count !== 1) puzzle[i] = saved;
    else clues--;
  }
  return { puzzle, solution, clues, unique: true, uniquenessChecks, seed };
}

/** Ejemplos precargados (con unicidad comprobada en las pruebas automáticas). */
export const SUDOKU_EXAMPLES = Object.freeze([
  {
    id: 'easy',
    name: 'Fácil',
    board: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  },
  {
    id: 'hard',
    name: 'Difícil ("AI Escargot")',
    board: '100007090030020008009600500005300900010080002600004000300000010040000007007000300',
  },
  {
    id: 'multiple',
    name: 'Con varias soluciones',
    board: '000070000600195000098000060800060003400803001700020006060000280000419005000080079',
    note: 'Es el ejemplo fácil sin las pistas 5 y 3 de la primera fila: tiene exactamente 2 soluciones.',
  },
  {
    id: 'invalid',
    name: 'Inválido (pistas repetidas)',
    board: '550070000600195000098000060800060003400803001700020006060000280000419005000080079',
  },
  {
    id: 'unsolvable',
    name: 'Sin solución (reglas válidas)',
    board: '516849732307605000809700065135060907472591006968370050253186074684207500791050608',
    note: 'Las pistas no se repiten, pero no existe ninguna compleción válida.',
  },
]);
