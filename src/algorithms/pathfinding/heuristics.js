import { MOVEMENT, SQRT2, toCoords } from './grid.js';

/**
 * Heurísticas para A*. Todas se multiplican por el coste mínimo de celda del mapa,
 * de modo que siguen siendo cotas inferiores cuando todas las celdas cuestan más de 1.
 *
 * Admisibilidad (h nunca sobreestima el coste real restante):
 *  - Movimiento ortogonal: Manhattan, Octil, Euclídea y Chebyshev son admisibles
 *    (Manhattan es la más informada).
 *  - Movimiento diagonal (paso diagonal = √2): Octil, Euclídea y Chebyshev son
 *    admisibles; Manhattan NO lo es porque cuenta 2 donde el coste real es √2.
 * Las admisibles de esta lista son además consistentes con estas reglas de coste,
 * así que A* sin reapertura de nodos cerrados devuelve caminos óptimos.
 */
export const HEURISTICS = Object.freeze({
  manhattan: {
    id: 'manhattan',
    name: 'Manhattan',
    distance: (dx, dy) => dx + dy,
    admissible: { [MOVEMENT.ORTHOGONAL]: true, [MOVEMENT.DIAGONAL]: false },
  },
  octile: {
    id: 'octile',
    name: 'Octil',
    distance: (dx, dy) => Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy),
    admissible: { [MOVEMENT.ORTHOGONAL]: true, [MOVEMENT.DIAGONAL]: true },
  },
  euclidean: {
    id: 'euclidean',
    name: 'Euclídea',
    distance: (dx, dy) => Math.sqrt(dx * dx + dy * dy),
    admissible: { [MOVEMENT.ORTHOGONAL]: true, [MOVEMENT.DIAGONAL]: true },
  },
  chebyshev: {
    id: 'chebyshev',
    name: 'Chebyshev',
    distance: (dx, dy) => Math.max(dx, dy),
    admissible: { [MOVEMENT.ORTHOGONAL]: true, [MOVEMENT.DIAGONAL]: true },
  },
  zero: {
    id: 'zero',
    name: 'Nula (h = 0, equivale a Dijkstra)',
    distance: () => 0,
    admissible: { [MOVEMENT.ORTHOGONAL]: true, [MOVEMENT.DIAGONAL]: true },
  },
});

export function getHeuristic(id) {
  const h = HEURISTICS[id];
  if (!h) throw new Error(`Heurística desconocida: ${id}`);
  return h;
}

export function isAdmissible(id, movement) {
  return Boolean(getHeuristic(id).admissible[movement]);
}

export function defaultHeuristicFor(movement) {
  return movement === MOVEMENT.DIAGONAL ? 'octile' : 'manhattan';
}

/** Crea una función h(index) para un objetivo concreto. */
export function makeHeuristicFn(grid, heuristicId, goal, minCost) {
  const { distance } = getHeuristic(heuristicId);
  const g = toCoords(grid, goal);
  return (index) => {
    const c = toCoords(grid, index);
    return minCost * distance(Math.abs(c.x - g.x), Math.abs(c.y - g.y));
  };
}
