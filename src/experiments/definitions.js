import { now, runToCompletion } from '../core/trace.js';
import { MOVEMENT } from '../algorithms/pathfinding/grid.js';
import { generateRandomObstacles } from '../algorithms/pathfinding/maps.js';
import { PATHFINDING_ALGORITHMS } from '../algorithms/pathfinding/search.js';
import { generateSudoku, solveSudoku } from '../algorithms/backtracking/sudoku.js';
import { CSP_PRESETS, solveCSP } from '../algorithms/csp/solver.js';
import { graphColoringCSP, randomGraph } from '../algorithms/csp/problems.js';
import { createSyntheticTree } from '../algorithms/game-theory/synthetic-tree.js';
import { gameTreeSearch } from '../algorithms/game-theory/search.js';
import { SELECTION_METHODS, geneticAlgorithm } from '../algorithms/genetic/engine.js';
import { functionProblem, knapsackProblem, randomCities, randomKnapsack, tspProblem } from '../algorithms/genetic/problems.js';

/**
 * Definiciones de experimentos reproducibles (independientes del DOM).
 *
 * Cada definición declara sus parámetros y una función `run(params, i)` que
 * ejecuta la repetición i y devuelve una fila por variante (algoritmo o
 * configuración). Todas las variantes de una repetición usan exactamente la
 * misma instancia (misma semilla), de modo que sus métricas y tiempos se
 * comparan sobre la misma carga de trabajo.
 *
 * La semilla de la repetición i es `seed + i`.
 */

const time = (fn) => {
  const t0 = now();
  const value = fn();
  return { value, ms: now() - t0 };
};

export const EXPERIMENTS = [
  {
    id: 'pathfinding',
    name: 'Búsqueda de caminos en mapas aleatorios',
    description: 'Los cuatro algoritmos sobre el mismo mapa en cada repetición. Si un mapa no tiene solución, el coste no se promedia.',
    params: [
      { key: 'size', label: 'Lado del mapa', type: 'int', min: 5, max: 120, default: 40 },
      { key: 'density', label: 'Densidad de obstáculos', type: 'float', min: 0, max: 0.6, default: 0.25 },
      { key: 'movement', label: 'Movimiento', type: 'select', default: MOVEMENT.ORTHOGONAL, options: [{ value: MOVEMENT.ORTHOGONAL, label: 'Ortogonal' }, { value: MOVEMENT.DIAGONAL, label: 'Diagonal' }] },
      { key: 'terrain', label: 'Costes de terreno', type: 'select', default: 'no', options: [{ value: 'no', label: 'No (coste uniforme)' }, { value: 'yes', label: 'Sí' }] },
      { key: 'runs', label: 'Repeticiones', type: 'int', min: 1, max: 500, default: 20 },
      { key: 'seed', label: 'Semilla inicial', type: 'int', min: 0, max: 999999999, default: 1 },
    ],
    metrics: [
      { key: 'found', label: 'Éxito (1 = camino)' },
      { key: 'cost', label: 'Coste del camino' },
      { key: 'moves', label: 'Movimientos' },
      { key: 'expanded', label: 'Nodos expandidos' },
      { key: 'discovered', label: 'Nodos descubiertos' },
      { key: 'operations', label: 'Operaciones de frontera' },
      { key: 'timeMs', label: 'Tiempo (ms)' },
    ],
    run(p, i) {
      const seed = p.seed + i;
      const grid = generateRandomObstacles(p.size, p.size, seed, { density: p.density, terrain: p.terrain === 'yes' });
      return Object.values(PATHFINDING_ALGORITHMS).map((algo) => {
        const { value: { result }, ms } = time(() => runToCompletion(algo.run(grid, { movement: p.movement, trace: false })));
        return {
          group: algo.name, run: i, seed,
          found: result.found ? 1 : 0,
          cost: result.found ? result.cost : null,
          moves: result.found ? result.moves : null,
          expanded: result.metrics.expanded,
          discovered: result.metrics.discovered,
          operations: result.metrics.pushes + result.metrics.pops,
          timeMs: ms,
        };
      });
    },
  },
  {
    id: 'sudoku',
    name: 'Sudoku: orden fijo vs. MRV',
    description: 'En cada repetición se genera un Sudoku de solución única (semilla + i) y se resuelve con ambas estrategias.',
    params: [
      { key: 'clues', label: 'Pistas objetivo', type: 'int', min: 22, max: 50, default: 28 },
      { key: 'runs', label: 'Repeticiones', type: 'int', min: 1, max: 100, default: 10 },
      { key: 'seed', label: 'Semilla inicial', type: 'int', min: 0, max: 999999999, default: 1 },
    ],
    metrics: [
      { key: 'nodes', label: 'Asignaciones' },
      { key: 'checks', label: 'Comprobaciones' },
      { key: 'backtracks', label: 'Retrocesos' },
      { key: 'timeMs', label: 'Tiempo (ms)' },
    ],
    run(p, i) {
      const seed = p.seed + i;
      const { puzzle } = generateSudoku(seed, { targetClues: p.clues });
      return [['static', 'Orden fijo'], ['mrv', 'MRV']].map(([order, label]) => {
        const { value: { result }, ms } = time(() => runToCompletion(solveSudoku(puzzle, { variableOrder: order, trace: false })));
        return { group: label, run: i, seed, nodes: result.metrics.nodes, checks: result.metrics.checks, backtracks: result.metrics.backtracks, timeMs: ms };
      });
    },
  },
  {
    id: 'csp',
    name: 'CSP: heurísticas en coloreado de grafos',
    description: 'Grafos aleatorios (semilla + i) coloreados con las cuatro configuraciones predefinidas. Se detiene cada búsqueda a los 200 000 nodos.',
    params: [
      { key: 'nodes', label: 'Nodos', type: 'int', min: 4, max: 60, default: 20 },
      { key: 'neighbors', label: 'Vecinos más próximos', type: 'int', min: 1, max: 6, default: 3 },
      { key: 'colors', label: 'Colores', type: 'int', min: 2, max: 6, default: 4 },
      { key: 'runs', label: 'Repeticiones', type: 'int', min: 1, max: 200, default: 20 },
      { key: 'seed', label: 'Semilla inicial', type: 'int', min: 0, max: 999999999, default: 1 },
    ],
    metrics: [
      { key: 'solved', label: 'Resuelto (1 = sí)' },
      { key: 'nodes', label: 'Asignaciones' },
      { key: 'checks', label: 'Comprobaciones' },
      { key: 'prunes', label: 'Valores podados' },
      { key: 'timeMs', label: 'Tiempo (ms)' },
    ],
    run(p, i) {
      const seed = p.seed + i;
      const graph = randomGraph(seed, { nodes: p.nodes, neighbors: p.neighbors });
      return Object.values(CSP_PRESETS).map((preset) => {
        const csp = graphColoringCSP({ ...graph, colors: p.colors });
        const { value: { result }, ms } = time(() => runToCompletion(solveCSP(csp, { ...preset.options, trace: false, maxNodes: 200000 })));
        return {
          group: preset.name, run: i, seed,
          solved: result.solutionCount > 0 ? 1 : 0,
          limit: result.limitReached ? 1 : 0,
          nodes: result.metrics.nodes, checks: result.metrics.checks, prunes: result.metrics.prunes, timeMs: ms,
        };
      });
    },
  },
  {
    id: 'games',
    name: 'Minimax vs. alfa-beta en árboles sintéticos',
    description: 'Árboles aleatorios (semilla + i). Se verifica en cada repetición que todas las variantes obtienen el mismo valor de la raíz.',
    params: [
      { key: 'branching', label: 'Ramificación', type: 'int', min: 2, max: 5, default: 3 },
      { key: 'depth', label: 'Profundidad', type: 'int', min: 1, max: 7, default: 5 },
      { key: 'runs', label: 'Repeticiones', type: 'int', min: 1, max: 500, default: 30 },
      { key: 'seed', label: 'Semilla inicial', type: 'int', min: 0, max: 999999999, default: 1 },
    ],
    metrics: [
      { key: 'visited', label: 'Nodos visitados' },
      { key: 'leaves', label: 'Hojas evaluadas' },
      { key: 'pruned', label: 'Ramas podadas' },
      { key: 'valueMatches', label: 'Valor = minimax (1 = sí)' },
      { key: 'timeMs', label: 'Tiempo (ms)' },
    ],
    run(p, i) {
      const seed = p.seed + i;
      const game = createSyntheticTree({ branching: p.branching, depth: p.depth, seed });
      const variants = [
        ['Minimax', { alphaBeta: false }],
        ['Alfa-beta (orden natural)', { alphaBeta: true, ordering: 'natural' }],
        ['Alfa-beta (orden aleatorio)', { alphaBeta: true, ordering: 'random', seed }],
        ['Alfa-beta (orden oráculo)', { alphaBeta: true, ordering: 'oracle' }],
      ];
      let reference = null;
      return variants.map(([label, options]) => {
        const { value: { result }, ms } = time(() => runToCompletion(gameTreeSearch(game, game.initialState, { ...options, trace: false })));
        if (reference === null) reference = result.value;
        return {
          group: label, run: i, seed,
          value: result.value,
          valueMatches: result.value === reference ? 1 : 0,
          visited: result.metrics.visited, leaves: result.metrics.leaves, pruned: result.metrics.prunedBranches, timeMs: ms,
        };
      });
    },
  },
  {
    id: 'genetic',
    name: 'Algoritmo genético: variabilidad entre semillas',
    description: 'La instancia es fija; cambia la semilla del AG (semilla + i). Se compara cada mejor resultado con el óptimo exacto. Opcionalmente se comparan los tres métodos de selección con las mismas semillas.',
    params: [
      { key: 'problem', label: 'Problema', type: 'select', default: 'knapsack', options: [{ value: 'function', label: 'Función f(x)' }, { value: 'knapsack', label: 'Mochila aleatoria (25 objetos)' }, { value: 'tsp', label: 'Viajante (10 ciudades)' }] },
      { key: 'instanceSeed', label: 'Semilla de la instancia', type: 'int', min: 0, max: 999999999, default: 3 },
      { key: 'populationSize', label: 'Población', type: 'int', min: 4, max: 500, default: 40 },
      { key: 'maxGenerations', label: 'Generaciones', type: 'int', min: 1, max: 2000, default: 80 },
      { key: 'mutationRate', label: 'Prob. mutación', type: 'float', min: 0, max: 1, default: 0.02 },
      { key: 'crossoverRate', label: 'Prob. cruce', type: 'float', min: 0, max: 1, default: 0.9 },
      { key: 'elitism', label: 'Elitismo', type: 'int', min: 0, max: 50, default: 1 },
      { key: 'selection', label: 'Selección', type: 'select', default: 'compare', options: [{ value: 'compare', label: 'Comparar los tres métodos' }, ...Object.entries(SELECTION_METHODS).map(([value, label]) => ({ value, label }))] },
      { key: 'runs', label: 'Repeticiones (semillas)', type: 'int', min: 1, max: 200, default: 20 },
      { key: 'seed', label: 'Semilla inicial del AG', type: 'int', min: 0, max: 999999999, default: 1 },
    ],
    metrics: [
      { key: 'bestFitness', label: 'Mejor aptitud' },
      { key: 'gap', label: 'Distancia al óptimo' },
      { key: 'hitOptimum', label: 'Alcanza el óptimo (1 = sí)' },
      { key: 'bestGeneration', label: 'Generación del mejor' },
      { key: 'timeMs', label: 'Tiempo (ms)' },
    ],
    prepare(p) {
      // La instancia y su óptimo exacto se calculan una sola vez por experimento.
      let problem;
      if (p.problem === 'function') problem = functionProblem();
      else if (p.problem === 'knapsack') problem = knapsackProblem(randomKnapsack(p.instanceSeed, { items: 25 }));
      else problem = tspProblem(randomCities(p.instanceSeed, 10));
      return { problem, exact: problem.exact() };
    },
    run(p, i, context) {
      const seed = p.seed + i;
      const methods = p.selection === 'compare' ? Object.keys(SELECTION_METHODS) : [p.selection];
      return methods.map((selection) => {
        const config = {
          populationSize: p.populationSize, maxGenerations: p.maxGenerations, mutationRate: p.mutationRate,
          crossoverRate: p.crossoverRate, elitism: Math.min(p.elitism, p.populationSize - 1), selection,
          tournamentSize: Math.min(3, p.populationSize), seed, stagnation: 0, targetFitness: null,
        };
        const { value: { result }, ms } = time(() => runToCompletion(geneticAlgorithm(context.problem, config, { trace: false })));
        const gap = context.exact.fitness - result.bestFitness;
        return {
          group: SELECTION_METHODS[selection], run: i, seed,
          bestFitness: result.bestFitness, gap, hitOptimum: gap <= 1e-9 ? 1 : 0, bestGeneration: result.bestGeneration, timeMs: ms,
        };
      });
    },
  },
];

export function getExperiment(id) {
  const def = EXPERIMENTS.find((e) => e.id === id);
  if (!def) throw new Error(`Experimento desconocido: ${id}`);
  return def;
}

/** Valida y normaliza parámetros según la definición. */
export function normalizeParams(def, raw) {
  const out = {};
  for (const param of def.params) {
    const value = raw[param.key] ?? param.default;
    if (param.type === 'int' || param.type === 'float') {
      const n = Number(value);
      const okType = param.type === 'int' ? Number.isInteger(n) : Number.isFinite(n);
      if (!okType || n < param.min || n > param.max) {
        throw new Error(`${param.label} debe ser un ${param.type === 'int' ? 'entero' : 'número'} entre ${param.min} y ${param.max}.`);
      }
      out[param.key] = n;
    } else if (param.type === 'select') {
      if (!param.options.some((o) => o.value === value)) throw new Error(`Valor no válido para ${param.label}.`);
      out[param.key] = value;
    }
  }
  return out;
}
