import { createRng } from '../../core/rng.js';
import { backtrackingSearch } from './engine.js';

/**
 * Asignación de tareas a agentes con coste mínimo.
 *
 * Restricciones explícitas:
 *  1. Habilidad: una tarea solo puede asignarse a un agente que tenga la
 *     habilidad que la tarea requiere.
 *  2. Capacidad: cada agente puede recibir como máximo `capacity` tareas.
 *  3. Incompatibilidad: ciertos pares de tareas no pueden ir al mismo agente.
 * Objetivo: minimizar la suma de costes cost[tarea][agente].
 *
 * Estrategias que se comparan:
 *  - simple: orden fijo de tareas, agentes en orden natural y sin poda por
 *    cota (enumera todas las asignaciones válidas).
 *  - mejorada: MRV (tarea con menos agentes viables), candidatos ordenados por
 *    coste creciente y poda por cota inferior (coste parcial + mínimo coste
 *    posible de cada tarea pendiente, ignorando capacidades: es optimista y,
 *    por tanto, una cota válida).
 * Ambas son exactas: deben obtener el mismo coste óptimo.
 */

export const DEFAULT_INSTANCE = Object.freeze({
  agents: [
    { id: 'ana', name: 'Ana', skills: ['web', 'datos'], capacity: 2 },
    { id: 'bruno', name: 'Bruno', skills: ['web', 'infra'], capacity: 2 },
    { id: 'carla', name: 'Carla', skills: ['datos', 'infra', 'web'], capacity: 2 },
    { id: 'diego', name: 'Diego', skills: ['datos', 'ui'], capacity: 2 },
  ],
  tasks: [
    { id: 't1', name: 'API REST', skill: 'web' },
    { id: 't2', name: 'Panel de control', skill: 'web' },
    { id: 't3', name: 'Modelo de datos', skill: 'datos' },
    { id: 't4', name: 'Despliegue', skill: 'infra' },
    { id: 't5', name: 'Informe mensual', skill: 'datos' },
    { id: 't6', name: 'Monitorización', skill: 'infra' },
    { id: 't7', name: 'Rediseño visual', skill: 'ui' },
  ],
  // cost[tarea][agente]
  cost: {
    t1: { ana: 4, bruno: 3, carla: 6, diego: 9 },
    t2: { ana: 5, bruno: 4, carla: 3, diego: 7 },
    t3: { ana: 3, bruno: 8, carla: 4, diego: 2 },
    t4: { ana: 9, bruno: 2, carla: 5, diego: 9 },
    t5: { ana: 2, bruno: 9, carla: 3, diego: 4 },
    t6: { ana: 9, bruno: 4, carla: 2, diego: 9 },
    t7: { ana: 9, bruno: 9, carla: 9, diego: 3 },
  },
  incompatible: [['t1', 't2'], ['t4', 't6']],
});

export function validateInstance(instance) {
  const errors = [];
  const agentIds = new Set(instance.agents.map((a) => a.id));
  const taskIds = new Set(instance.tasks.map((t) => t.id));
  for (const t of instance.tasks) {
    for (const a of instance.agents) {
      const c = instance.cost?.[t.id]?.[a.id];
      if (!Number.isFinite(c) || c < 0) errors.push(`Falta un coste no negativo para ${t.name} con ${a.name}.`);
    }
  }
  for (const a of instance.agents) {
    if (!Number.isInteger(a.capacity) || a.capacity < 0) errors.push(`Capacidad no válida para ${a.name}.`);
  }
  for (const [x, y] of instance.incompatible ?? []) {
    if (!taskIds.has(x) || !taskIds.has(y)) errors.push(`Incompatibilidad con tareas desconocidas: ${x}, ${y}.`);
  }
  if (agentIds.size !== instance.agents.length) errors.push('Hay identificadores de agente repetidos.');
  return { valid: errors.length === 0, errors };
}

export function createTaskAssignmentProblem(instance) {
  const { valid, errors } = validateInstance(instance);
  if (!valid) throw new Error(errors.join(' '));
  const agentsById = new Map(instance.agents.map((a) => [a.id, a]));
  const tasksById = new Map(instance.tasks.map((t) => [t.id, t]));
  const incompatibleWith = new Map(instance.tasks.map((t) => [t.id, new Set()]));
  for (const [x, y] of instance.incompatible ?? []) {
    incompatibleWith.get(x).add(y);
    incompatibleWith.get(y).add(x);
  }
  const load = new Map(instance.agents.map((a) => [a.id, 0]));
  const agentIds = instance.agents.map((a) => a.id);
  // Mínimo coste posible por tarea entre agentes con la habilidad (para la cota).
  const minCost = new Map(instance.tasks.map((t) => {
    const costs = instance.agents.filter((a) => a.skills.includes(t.skill)).map((a) => instance.cost[t.id][a.id]);
    return [t.id, costs.length ? Math.min(...costs) : Infinity];
  }));

  return {
    name: 'Asignación de tareas',
    variables: instance.tasks.map((t) => t.id),
    values: () => agentIds,
    check(taskId, agentId, assignment) {
      const task = tasksById.get(taskId);
      const agent = agentsById.get(agentId);
      if (!agent.skills.includes(task.skill)) return { reason: `no es posible: ${agent.name} no tiene la habilidad "${task.skill}"`, conflicts: [] };
      if (load.get(agentId) >= agent.capacity) {
        const holders = [...assignment].filter(([, a]) => a === agentId).map(([t]) => t);
        return { reason: `supera la capacidad de ${agent.name} (${agent.capacity})`, conflicts: holders };
      }
      for (const other of incompatibleWith.get(taskId)) {
        if (assignment.get(other) === agentId) {
          return { reason: `es incompatible con ${tasksById.get(other).name}, ya asignada a ${agent.name}`, conflicts: [other] };
        }
      }
      return null;
    },
    assign(_taskId, agentId) { load.set(agentId, load.get(agentId) + 1); },
    unassign(_taskId, agentId) { load.set(agentId, load.get(agentId) - 1); },
    orderValues(taskId, values) {
      return values.slice().sort((a, b) => instance.cost[taskId][a] - instance.cost[taskId][b]);
    },
    cost(assignment) {
      let total = 0;
      for (const [t, a] of assignment) total += instance.cost[t][a];
      return total;
    },
    lowerBound(assignment) {
      let total = 0;
      for (const t of instance.tasks) {
        total += assignment.has(t.id) ? instance.cost[t.id][assignment.get(t.id)] : minCost.get(t.id);
      }
      return total;
    },
    label(taskId, agentId) {
      const task = tasksById.get(taskId);
      return agentId === undefined ? task.name : `${task.name} → ${agentsById.get(agentId).name} (coste ${instance.cost[taskId][agentId]})`;
    },
  };
}

export const TASK_STRATEGIES = Object.freeze({
  simple: { id: 'simple', name: 'Simple (orden fijo, sin poda)', options: { variableOrder: 'static', valueOrder: 'natural', useBound: false } },
  improved: { id: 'improved', name: 'Mejorada (MRV + menor coste primero + cota)', options: { variableOrder: 'mrv', valueOrder: 'heuristic', useBound: true } },
});

export function* solveTaskAssignment(instance, { strategy = 'improved', trace = true } = {}) {
  const config = TASK_STRATEGIES[strategy];
  if (!config) throw new Error(`Estrategia desconocida: ${strategy}`);
  return yield* backtrackingSearch(createTaskAssignmentProblem(instance), { mode: 'optimize', trace, ...config.options });
}

/** Comprueba que una asignación cumple todas las restricciones de la instancia. */
export function isValidAssignment(instance, assignment) {
  const load = new Map();
  for (const task of instance.tasks) {
    const agentId = assignment[task.id];
    const agent = instance.agents.find((a) => a.id === agentId);
    if (!agent || !agent.skills.includes(task.skill)) return false;
    load.set(agentId, (load.get(agentId) ?? 0) + 1);
    if (load.get(agentId) > agent.capacity) return false;
  }
  for (const [x, y] of instance.incompatible ?? []) {
    if (assignment[x] === assignment[y]) return false;
  }
  return true;
}

/** Instancia aleatoria reproducible. */
export function randomInstance(seed = 1, { agents = 4, tasks = 7 } = {}) {
  const rng = createRng(seed);
  const skills = ['web', 'datos', 'infra', 'ui'];
  const names = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Félix', 'Gema', 'Hugo'];
  const agentList = Array.from({ length: agents }, (_, i) => {
    const own = skills.filter(() => rng.bool(0.5));
    if (own.length === 0) own.push(rng.pick(skills));
    return { id: `a${i + 1}`, name: names[i % names.length], skills: own, capacity: rng.int(1, 3) };
  });
  const taskList = Array.from({ length: tasks }, (_, i) => ({ id: `t${i + 1}`, name: `Tarea ${i + 1}`, skill: rng.pick(skills) }));
  const cost = {};
  for (const t of taskList) {
    cost[t.id] = {};
    for (const a of agentList) cost[t.id][a.id] = rng.int(1, 9);
  }
  const incompatible = [];
  for (let k = 0; k < Math.floor(tasks / 3); k++) {
    const x = rng.pick(taskList).id;
    const y = rng.pick(taskList).id;
    if (x !== y) incompatible.push([x, y]);
  }
  return { agents: agentList, tasks: taskList, cost, incompatible };
}
