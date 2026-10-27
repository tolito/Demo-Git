/**
 * Modelo de cuadrícula para búsqueda de caminos.
 *
 * Reglas de movimiento (documentadas también en el README):
 *  - Ortogonal: 4 vecinos (N, E, S, O), longitud de paso 1.
 *  - Diagonal: 8 vecinos; los pasos diagonales miden √2.
 *  - No se atraviesan esquinas: un movimiento diagonal solo se permite si las dos
 *    celdas ortogonales que lo flanquean son transitables.
 *  - Coste de un movimiento = coste de la celda de destino × longitud del paso.
 *    Los costes de celda son enteros >= 1, por lo que todos los costes son positivos.
 */

export const MOVEMENT = Object.freeze({ ORTHOGONAL: 'orthogonal', DIAGONAL: 'diagonal' });
export const SQRT2 = Math.SQRT2;
export const MIN_SIZE = 2;
export const MAX_SIZE = 150;

// Orden fijo de exploración de vecinos: determina la traza y los desempates.
const ORTHOGONAL_DIRS = [
  { dx: 0, dy: -1, name: 'N' },
  { dx: 1, dy: 0, name: 'E' },
  { dx: 0, dy: 1, name: 'S' },
  { dx: -1, dy: 0, name: 'O' },
];
const DIAGONAL_DIRS = [
  { dx: 1, dy: -1, name: 'NE' },
  { dx: 1, dy: 1, name: 'SE' },
  { dx: -1, dy: 1, name: 'SO' },
  { dx: -1, dy: -1, name: 'NO' },
];

export function createGrid(width, height, { start, goal } = {}) {
  validateSize(width, height);
  const cells = width * height;
  return {
    width,
    height,
    walls: new Uint8Array(cells),
    costs: new Uint8Array(cells).fill(1),
    start: start ?? 0,
    goal: goal ?? cells - 1,
  };
}

export function validateSize(width, height) {
  for (const [label, value] of [['ancho', width], ['alto', height]]) {
    if (!Number.isInteger(value) || value < MIN_SIZE || value > MAX_SIZE) {
      throw new RangeError(`El ${label} de la cuadrícula debe ser un entero entre ${MIN_SIZE} y ${MAX_SIZE}.`);
    }
  }
}

export function cloneGrid(grid) {
  return {
    width: grid.width,
    height: grid.height,
    walls: new Uint8Array(grid.walls),
    costs: new Uint8Array(grid.costs),
    start: grid.start,
    goal: grid.goal,
  };
}

export function toIndex(grid, x, y) {
  return y * grid.width + x;
}

export function toCoords(grid, index) {
  return { x: index % grid.width, y: Math.floor(index / grid.width) };
}

export function formatCell(grid, index) {
  const { x, y } = toCoords(grid, index);
  return `(${x},${y})`;
}

export function inBounds(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function isWalkable(grid, index) {
  return index >= 0 && index < grid.walls.length && grid.walls[index] === 0;
}

/** Coste mínimo de celda entre las celdas transitables (>= 1). */
export function minCellCost(grid) {
  let min = Infinity;
  for (let i = 0; i < grid.costs.length; i++) {
    if (grid.walls[i] === 0 && grid.costs[i] < min) min = grid.costs[i];
  }
  return Number.isFinite(min) ? min : 1;
}

/**
 * Vecinos transitables de una celda con su longitud de paso y su coste.
 * El orden es siempre N, E, S, O y después NE, SE, SO, NO.
 */
export function neighbors(grid, index, movement = MOVEMENT.ORTHOGONAL) {
  const { x, y } = toCoords(grid, index);
  const result = [];
  for (const dir of ORTHOGONAL_DIRS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(grid, nx, ny)) continue;
    const n = toIndex(grid, nx, ny);
    if (grid.walls[n]) continue;
    result.push({ index: n, stepLength: 1, cost: grid.costs[n], direction: dir.name });
  }
  if (movement === MOVEMENT.DIAGONAL) {
    for (const dir of DIAGONAL_DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(grid, nx, ny)) continue;
      const n = toIndex(grid, nx, ny);
      if (grid.walls[n]) continue;
      // Regla de no atravesar esquinas: ambas celdas ortogonales deben estar libres.
      if (grid.walls[toIndex(grid, x + dir.dx, y)] || grid.walls[toIndex(grid, x, y + dir.dy)]) continue;
      result.push({ index: n, stepLength: SQRT2, cost: grid.costs[n] * SQRT2, direction: dir.name });
    }
  }
  return result;
}

/**
 * Valida un camino y calcula sus magnitudes a partir de las celdas que lo forman.
 * Lanza un error si el camino no es válido según las reglas de movimiento.
 */
export function measurePath(grid, path, movement = MOVEMENT.ORTHOGONAL) {
  if (!Array.isArray(path) || path.length === 0) {
    return { moves: 0, geometricLength: 0, cost: 0, valid: false };
  }
  let cost = 0;
  let geometricLength = 0;
  for (let i = 0; i < path.length; i++) {
    if (!isWalkable(grid, path[i])) throw new Error(`El camino atraviesa un obstáculo en ${formatCell(grid, path[i])}.`);
    if (i === 0) continue;
    const step = neighbors(grid, path[i - 1], movement).find((n) => n.index === path[i]);
    if (!step) {
      throw new Error(`Movimiento no permitido de ${formatCell(grid, path[i - 1])} a ${formatCell(grid, path[i])}.`);
    }
    cost += step.cost;
    geometricLength += step.stepLength;
  }
  return { moves: path.length - 1, geometricLength, cost, valid: true };
}
