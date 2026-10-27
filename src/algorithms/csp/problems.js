import { createRng } from '../../core/rng.js';
import { createCSP, naryConstraint, notEqual, binaryConstraint } from './csp.js';
import { PEERS, cellName } from '../backtracking/sudoku.js';

/**
 * Problemas de demostración modelados como CSP.
 */

export const COLOR_NAMES = ['rojo', 'verde', 'azul', 'amarillo', 'morado', 'naranja'];

/** Coloreado de grafos: variables = nodos, dominio = k colores, aristas = "≠". */
export function graphColoringCSP({ nodes, edges, colors, positions, name = 'Coloreado de grafo' }) {
  if (!Number.isInteger(colors) || colors < 1 || colors > COLOR_NAMES.length) {
    throw new RangeError(`El número de colores debe estar entre 1 y ${COLOR_NAMES.length}.`);
  }
  const domain = Array.from({ length: colors }, (_, i) => i);
  const domains = Object.fromEntries(nodes.map((n) => [n, domain]));
  const constraints = edges.map(([a, b]) => notEqual(a, b));
  return createCSP({
    name,
    variables: nodes,
    domains,
    constraints,
    meta: { kind: 'graph', nodes, edges, positions, formatValue: (v) => COLOR_NAMES[v] },
  });
}

/** Mapa de Australia (ejemplo clásico de Russell y Norvig). */
export const AUSTRALIA = Object.freeze({
  name: 'Mapa de Australia',
  nodes: ['WA', 'NT', 'SA', 'Q', 'NSW', 'V', 'T'],
  edges: [['WA', 'NT'], ['WA', 'SA'], ['NT', 'SA'], ['NT', 'Q'], ['SA', 'Q'], ['SA', 'NSW'], ['SA', 'V'], ['Q', 'NSW'], ['NSW', 'V']],
  positions: {
    WA: [0.18, 0.45], NT: [0.45, 0.22], SA: [0.5, 0.55], Q: [0.78, 0.25], NSW: [0.82, 0.58], V: [0.7, 0.8], T: [0.74, 0.96],
  },
});

/** K4 con 3 colores: arco-consistente al principio pero sin solución. */
export const K4 = Object.freeze({
  name: 'Grafo completo K4',
  nodes: ['A', 'B', 'C', 'D'],
  edges: [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']],
  positions: { A: [0.2, 0.2], B: [0.8, 0.2], C: [0.2, 0.8], D: [0.8, 0.8] },
});

/**
 * Grafo aleatorio reproducible: puntos en el plano unidos a sus vecinos más
 * próximos (evita grafos excesivamente densos y produce dibujos legibles).
 */
export function randomGraph(seed = 1, { nodes = 12, neighbors = 3 } = {}) {
  const rng = createRng(seed);
  const ids = Array.from({ length: nodes }, (_, i) => `N${i + 1}`);
  const positions = {};
  for (const id of ids) positions[id] = [rng.range(0.06, 0.94), rng.range(0.06, 0.94)];
  const edgeSet = new Set();
  const edges = [];
  for (const a of ids) {
    const sorted = ids.filter((b) => b !== a)
      .map((b) => [b, Math.hypot(positions[a][0] - positions[b][0], positions[a][1] - positions[b][1])])
      .sort((x, y) => x[1] - y[1])
      .slice(0, neighbors);
    for (const [b] of sorted) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(a < b ? [a, b] : [b, a]);
      }
    }
  }
  return { name: `Grafo aleatorio (semilla ${seed})`, nodes: ids, edges, positions };
}

/**
 * Sudoku como CSP: 81 variables, dominio {1..9} (o la pista), y una restricción
 * binaria "≠" por cada par de celdas que comparten fila, columna o caja (810).
 */
export function sudokuCSP(board) {
  const variables = Array.from({ length: 81 }, (_, i) => cellName(i));
  const domains = {};
  for (let i = 0; i < 81; i++) domains[variables[i]] = board[i] ? [board[i]] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const constraints = [];
  for (let i = 0; i < 81; i++) {
    for (const j of PEERS[i]) if (j > i) constraints.push(notEqual(variables[i], variables[j]));
  }
  return createCSP({ name: 'Sudoku (CSP)', variables, domains, constraints, meta: { kind: 'sudoku', board: board.slice() } });
}

/**
 * Asignación de tareas como CSP:
 *  - Variables: tareas; dominio: agentes con la habilidad requerida
 *    (la restricción unaria de habilidad se aplica al construir los dominios).
 *  - Binarias: tareas incompatibles van a agentes distintos; tareas "juntas"
 *    van al mismo agente.
 *  - N-aria: capacidad de cada agente (como máximo `capacity` tareas).
 */
export function taskAssignmentCSP(instance) {
  const variables = instance.tasks.map((t) => t.id);
  const domains = {};
  for (const t of instance.tasks) {
    domains[t.id] = instance.agents.filter((a) => a.skills.includes(t.skill)).map((a) => a.id);
  }
  const taskName = (id) => instance.tasks.find((t) => t.id === id)?.name ?? id;
  const constraints = [];
  for (const [x, y] of instance.incompatible ?? []) {
    constraints.push(notEqual(x, y, `${taskName(x)} y ${taskName(y)} con agentes distintos`));
  }
  for (const [x, y] of instance.together ?? []) {
    constraints.push(binaryConstraint(x, y, (a, b) => a === b, `${taskName(x)} y ${taskName(y)} con el mismo agente`));
  }
  for (const agent of instance.agents) {
    constraints.push(naryConstraint(variables, (assignment) => {
      let count = 0;
      for (const v of assignment.values()) if (v === agent.id) count++;
      return count <= agent.capacity;
    }, `capacidad de ${agent.name} (máx. ${agent.capacity})`));
  }
  const agentName = (id) => instance.agents.find((a) => a.id === id)?.name ?? id;
  return createCSP({
    name: 'Asignación de tareas (CSP)',
    variables,
    domains,
    constraints,
    meta: { kind: 'tasks', instance, formatValue: agentName, taskName },
  });
}

export const TASK_CSP_INSTANCE = Object.freeze({
  agents: [
    { id: 'ana', name: 'Ana', skills: ['web', 'datos'], capacity: 2 },
    { id: 'bruno', name: 'Bruno', skills: ['web', 'infra'], capacity: 2 },
    { id: 'carla', name: 'Carla', skills: ['datos', 'infra'], capacity: 2 },
    { id: 'diego', name: 'Diego', skills: ['ui', 'web'], capacity: 1 },
  ],
  tasks: [
    { id: 't1', name: 'API', skill: 'web' },
    { id: 't2', name: 'Panel', skill: 'web' },
    { id: 't3', name: 'ETL', skill: 'datos' },
    { id: 't4', name: 'Despliegue', skill: 'infra' },
    { id: 't5', name: 'Informe', skill: 'datos' },
    { id: 't6', name: 'Diseño', skill: 'ui' },
    { id: 't7', name: 'Backups', skill: 'infra' },
  ],
  incompatible: [['t1', 't2'], ['t4', 't7'], ['t3', 't5']],
  together: [['t1', 't4']],
});

/** Variante sin solución: hay más tareas de infraestructura que capacidad disponible. */
export const TASK_CSP_IMPOSSIBLE = Object.freeze({
  ...TASK_CSP_INSTANCE,
  agents: TASK_CSP_INSTANCE.agents.map((a) => (a.id === 'carla' ? { ...a, capacity: 0 } : a)),
});
