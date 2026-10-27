/**
 * Tres en raya.
 *
 * Estado: { board: array de 9 ('X' | 'O' | null), toMove: 'X' | 'O' }.
 * X es siempre MAX y O es MIN. Las casillas se numeran 0..8 por filas.
 *
 * Utilidad exacta de un estado terminal (desde el punto de vista de X):
 *   gana X: +(100 - fichas en el tablero)   → prefiere ganar antes
 *   gana O: -(100 - fichas en el tablero)   → prefiere perder más tarde
 *   empate: 0
 * El signo del valor del juego es independiente de este ajuste: con juego
 * perfecto desde el tablero vacío el valor es 0 (empate).
 *
 * Evaluación heurística (solo para estados no terminales cuando se corta la
 * búsqueda por profundidad): para cada una de las 8 líneas que no contiene
 * fichas de ambos jugadores, suma +1 / +3 si X tiene 1 / 2 fichas en ella, y
 * resta lo mismo para O. Su valor absoluto es como mucho 24, de modo que nunca
 * se confunde con una utilidad terminal (|u| >= 91).
 */

export const LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]);

export function createState(board = Array(9).fill(null), toMove = null) {
  if (!Array.isArray(board) || board.length !== 9) throw new Error('El tablero debe tener 9 casillas.');
  for (const c of board) if (c !== null && c !== 'X' && c !== 'O') throw new Error(`Casilla no válida: ${c}`);
  const x = board.filter((c) => c === 'X').length;
  const o = board.filter((c) => c === 'O').length;
  // X empieza siempre: x == o (turno de X) o x == o + 1 (turno de O).
  if (x !== o && x !== o + 1) throw new Error(`Estado inconsistente: ${x} X y ${o} O (X empieza siempre).`);
  const expected = x === o ? 'X' : 'O';
  if (toMove !== null && toMove !== expected) throw new Error(`Turno inconsistente: le toca a ${expected}.`);
  const state = { board: board.slice(), toMove: expected };
  const wx = winnerOf(state.board, 'X');
  const wo = winnerOf(state.board, 'O');
  if (wx && wo) throw new Error('Estado inconsistente: ganan los dos jugadores.');
  if (wx && x !== o + 1) throw new Error('Estado inconsistente: X ha ganado pero O ha seguido jugando.');
  if (wo && x !== o) throw new Error('Estado inconsistente: O ha ganado pero X ha seguido jugando.');
  return state;
}

export function parseBoard(text) {
  const chars = String(text).toUpperCase().replace(/[^XO.\-_ ]/g, '').replace(/[-_ ]/g, '.');
  if (chars.length !== 9) throw new Error('Se necesitan 9 caracteres (X, O o .).');
  return createState(Array.from(chars, (c) => (c === '.' ? null : c)));
}

export function formatBoard(board) {
  return board.map((c) => c ?? '.').join('');
}

function winnerOf(board, player) {
  return LINES.some((line) => line.every((i) => board[i] === player));
}

export function winner(state) {
  if (winnerOf(state.board, 'X')) return 'X';
  if (winnerOf(state.board, 'O')) return 'O';
  return null;
}

export function winningLine(state) {
  return LINES.find((line) => line.every((i) => state.board[i] && state.board[i] === state.board[line[0]])) ?? null;
}

export function isTerminal(state) {
  return winner(state) !== null || state.board.every((c) => c !== null);
}

export function legalMoves(state) {
  if (isTerminal(state)) return [];
  const moves = [];
  for (let i = 0; i < 9; i++) if (state.board[i] === null) moves.push(i);
  return moves;
}

export function applyMove(state, move) {
  if (!Number.isInteger(move) || move < 0 || move > 8) throw new Error(`Movimiento fuera del tablero: ${move}`);
  if (isTerminal(state)) throw new Error('La partida ya ha terminado.');
  if (state.board[move] !== null) throw new Error(`La casilla ${move} ya está ocupada.`);
  const board = state.board.slice();
  board[move] = state.toMove;
  return { board, toMove: state.toMove === 'X' ? 'O' : 'X' };
}

export function utility(state) {
  const w = winner(state);
  const filled = state.board.filter((c) => c !== null).length;
  if (w === 'X') return 100 - filled;
  if (w === 'O') return -(100 - filled);
  return 0;
}

export function evaluate(state) {
  let score = 0;
  for (const line of LINES) {
    let x = 0;
    let o = 0;
    for (const i of line) {
      if (state.board[i] === 'X') x++;
      else if (state.board[i] === 'O') o++;
    }
    if (x && !o) score += x === 1 ? 1 : 3;
    else if (o && !x) score -= o === 1 ? 1 : 3;
  }
  return score;
}

export function resultLabel(state) {
  const w = winner(state);
  if (w) return `Gana ${w}`;
  if (isTerminal(state)) return 'Empate';
  return `Turno de ${state.toMove}`;
}

const CELL_NAMES = ['arriba-izquierda', 'arriba-centro', 'arriba-derecha', 'centro-izquierda', 'centro', 'centro-derecha', 'abajo-izquierda', 'abajo-centro', 'abajo-derecha'];

/** Preferencia estática de casillas para la ordenación heurística: centro, esquinas, lados. */
const CELL_PRIORITY = [1, 0, 1, 0, 2, 0, 1, 0, 1];

/** Interfaz común de juego usada por minimax / alfa-beta. */
export const ticTacToe = Object.freeze({
  id: 'tictactoe',
  name: 'Tres en raya',
  isTerminal,
  legalMoves,
  applyMove,
  utility,
  evaluate,
  isMaxTurn: (state) => state.toMove === 'X',
  moveLabel: (move, state) => `${state ? state.toMove : ''} en ${CELL_NAMES[move]}`.trim(),
  /** Orden heurístico: primero jugadas ganadoras inmediatas, luego centro, esquinas y lados. */
  orderMovesHeuristic(state, moves) {
    const score = (m) => {
      const next = applyMove(state, m);
      if (winner(next)) return 10;
      return CELL_PRIORITY[m];
    };
    return moves.map((m, i) => ({ m, s: score(m), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((e) => e.m);
  },
});

export const TICTACTOE_POSITIONS = Object.freeze([
  { id: 'empty', name: 'Tablero vacío (árbol completo)', board: '.........' },
  { id: 'win-now', name: 'X gana en una jugada', board: 'XX.OO....' },
  { id: 'must-block', name: 'X debe bloquear', board: 'X..OO...X' },
  { id: 'corners', name: 'O debe jugar un lado (esquinas opuestas)', board: 'X...O...X' },
  { id: 'midgame', name: 'Medio juego: X gana', board: 'X.O.X.O..' },
  { id: 'o-block', name: 'O debe bloquear', board: 'X...O.X..' },
  { id: 'opening', name: 'Tras X en el centro', board: '....X....' },
]);
