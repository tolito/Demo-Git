import { pathfindingLab } from './pathfinding-lab.js';
import { backtrackingLab } from './backtracking-lab.js';
import { cspLab } from './csp-lab.js';
import { gamesLab } from './games-lab.js';
import { geneticLab } from './genetic-lab.js';
import { experimentsLab } from './experiments-lab.js';

/**
 * Registro de laboratorios. Para añadir uno nuevo basta con implementar
 * { id, title, summary, mount(container) -> limpieza } y añadirlo aquí.
 */
export const LABS = [
  pathfindingLab,
  backtrackingLab,
  cspLab,
  gamesLab,
  geneticLab,
  experimentsLab,
];
