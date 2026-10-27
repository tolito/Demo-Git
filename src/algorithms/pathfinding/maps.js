import { createRng } from '../../core/rng.js';
import { createGrid, toIndex } from './grid.js';

/**
 * Generadores de mapas y escenarios predefinidos. Todos son deterministas
 * dada la semilla.
 */

export const TERRAIN = Object.freeze([
  { cost: 1, name: 'Llano' },
  { cost: 3, name: 'Hierba alta' },
  { cost: 5, name: 'Barro' },
  { cost: 9, name: 'Agua poco profunda' },
]);

/**
 * Laberinto perfecto mediante backtracking recursivo aleatorio (DFS sobre las
 * celdas impares). Las dimensiones se tratan para que el borde sea muro.
 * `openness` (0..1) elimina muros adicionales para crear ciclos.
 */
export function generateMaze(width, height, seed = 1, { openness = 0 } = {}) {
  const rng = createRng(seed);
  const grid = createGrid(width, height);
  grid.walls.fill(1);
  const cellsX = Math.floor((width - 1) / 2);
  const cellsY = Math.floor((height - 1) / 2);
  if (cellsX < 1 || cellsY < 1) {
    grid.walls.fill(0);
    grid.start = 0;
    grid.goal = width * height - 1;
    return grid;
  }
  const visited = new Uint8Array(cellsX * cellsY);
  const stack = [[0, 0]];
  visited[0] = 1;
  grid.walls[toIndex(grid, 1, 1)] = 0;
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = [];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < cellsX && ny < cellsY && !visited[ny * cellsX + nx]) options.push([nx, ny, dx, dy]);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny, dx, dy] = rng.pick(options);
    visited[ny * cellsX + nx] = 1;
    grid.walls[toIndex(grid, 2 * cx + 1 + dx, 2 * cy + 1 + dy)] = 0;
    grid.walls[toIndex(grid, 2 * nx + 1, 2 * ny + 1)] = 0;
    stack.push([nx, ny]);
  }
  if (openness > 0) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = toIndex(grid, x, y);
        if (grid.walls[i] && rng.next() < openness) grid.walls[i] = 0;
      }
    }
  }
  grid.start = toIndex(grid, 1, 1);
  grid.goal = toIndex(grid, 2 * (cellsX - 1) + 1, 2 * (cellsY - 1) + 1);
  return grid;
}

/** Obstáculos aleatorios independientes con densidad dada (origen y destino libres). */
export function generateRandomObstacles(width, height, seed = 1, { density = 0.25, terrain = false } = {}) {
  const rng = createRng(seed);
  const grid = createGrid(width, height);
  for (let i = 0; i < grid.walls.length; i++) {
    if (rng.next() < density) grid.walls[i] = 1;
    else if (terrain) grid.costs[i] = rng.pick([1, 1, 1, 3, 5, 9]);
  }
  grid.start = 0;
  grid.goal = grid.walls.length - 1;
  grid.walls[grid.start] = 0;
  grid.walls[grid.goal] = 0;
  return grid;
}

/** Escenarios predefinidos pensados para mostrar diferencias concretas. */
export const SCENARIOS = Object.freeze([
  {
    id: 'empty',
    name: 'Mapa vacío',
    description: 'Sin obstáculos: muestra la forma de la frontera de cada algoritmo.',
    build() {
      const grid = createGrid(25, 17);
      grid.start = toIndex(grid, 3, 8);
      grid.goal = toIndex(grid, 21, 8);
      return grid;
    },
  },
  {
    id: 'wall-gap',
    name: 'Muro con hueco',
    description: 'Un muro vertical obliga a rodear; A* con buena heurística expande menos nodos.',
    build() {
      const grid = createGrid(25, 17);
      for (let y = 1; y < 16; y++) if (y !== 14) grid.walls[toIndex(grid, 12, y)] = 1;
      grid.start = toIndex(grid, 4, 8);
      grid.goal = toIndex(grid, 20, 8);
      return grid;
    },
  },
  {
    id: 'terrain',
    name: 'Terreno con costes',
    description: 'Una franja de agua cara: BFS la cruza (menos pasos), Dijkstra y A* la rodean (menor coste).',
    build() {
      const grid = createGrid(25, 17);
      for (let y = 0; y < 17; y++) {
        for (let x = 10; x <= 14; x++) grid.costs[toIndex(grid, x, y)] = y < 13 ? 9 : 1;
      }
      for (let y = 13; y < 17; y++) for (let x = 10; x <= 14; x++) grid.costs[toIndex(grid, x, y)] = 3;
      grid.start = toIndex(grid, 3, 4);
      grid.goal = toIndex(grid, 21, 4);
      return grid;
    },
  },
  {
    id: 'dfs-trap',
    name: 'Trampa para DFS',
    description: 'El destino está cerca, pero DFS se adentra antes en un pasillo largo: ruta válida pero no óptima.',
    build() {
      const grid = createGrid(21, 15);
      for (let x = 2; x < 19; x++) grid.walls[toIndex(grid, x, 2)] = 1;
      for (let y = 2; y < 13; y++) grid.walls[toIndex(grid, 18, y)] = 1;
      grid.start = toIndex(grid, 5, 7);
      grid.goal = toIndex(grid, 9, 7);
      return grid;
    },
  },
  {
    id: 'no-path',
    name: 'Sin solución',
    description: 'El destino está encerrado: todos los algoritmos deben detectar que no hay camino.',
    build() {
      const grid = createGrid(21, 15);
      for (let x = 13; x <= 17; x++) {
        grid.walls[toIndex(grid, x, 4)] = 1;
        grid.walls[toIndex(grid, x, 10)] = 1;
      }
      for (let y = 4; y <= 10; y++) {
        grid.walls[toIndex(grid, 13, y)] = 1;
        grid.walls[toIndex(grid, 17, y)] = 1;
      }
      grid.start = toIndex(grid, 3, 7);
      grid.goal = toIndex(grid, 15, 7);
      return grid;
    },
  },
  {
    id: 'maze',
    name: 'Laberinto (semilla 7)',
    description: 'Laberinto perfecto: existe un único camino simple entre dos celdas.',
    build() {
      return generateMaze(31, 21, 7);
    },
  },
  {
    id: 'corner',
    name: 'Esquinas diagonales',
    description: 'Con movimiento diagonal se comprueba la regla de no atravesar esquinas bloqueadas.',
    build() {
      const grid = createGrid(9, 9);
      // Diagonal de muros: solo pasable cortando esquinas, lo que está prohibido.
      for (let i = 0; i < 9; i++) grid.walls[toIndex(grid, i, 8 - i)] = 1;
      grid.walls[toIndex(grid, 4, 4)] = 0;
      grid.walls[toIndex(grid, 5, 4)] = 1;
      grid.start = toIndex(grid, 0, 0);
      grid.goal = toIndex(grid, 8, 8);
      return grid;
    },
  },
]);

export function getScenario(id) {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Escenario desconocido: ${id}`);
  return scenario;
}
