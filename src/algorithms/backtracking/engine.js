import { makeEvent } from '../../core/trace.js';

/**
 * Motor genérico de backtracking.
 *
 * Un problema se describe con:
 *   variables: array de identificadores.
 *   values(variable): dominio completo en orden natural.
 *   check(variable, value, assignment): null si es compatible con la asignación
 *       parcial, o { reason, conflicts: [variables] } si viola una restricción.
 *   label(variable, value?): texto legible para los mensajes.
 * Opcionales:
 *   orderValues(variable, values, assignment): reordena candidatos (heurística).
 *   assign(variable, value) / unassign(variable, value): mantener cachés internas.
 *   cost(assignment) y lowerBound(assignment): para el modo 'optimize'
 *       (ramificación y poda: se poda si lowerBound >= mejor coste conocido).
 *
 * Opciones:
 *   mode: 'first' | 'all' | 'optimize'
 *   maxSolutions: límite de soluciones en modo 'all'.
 *   variableOrder: 'static' (orden de `variables`) | 'mrv' (menos candidatos
 *       consistentes; las comprobaciones que hace MRV se cuentan en las métricas).
 *   valueOrder: 'natural' | 'heuristic' (usa problem.orderValues).
 *   useBound: en modo 'optimize', aplica la poda por cota.
 *   trace: emitir eventos.
 */
export function* backtrackingSearch(problem, options = {}) {
  const {
    mode = 'first',
    maxSolutions = mode === 'first' ? 1 : Infinity,
    variableOrder = 'static',
    valueOrder = 'natural',
    useBound = true,
    trace = true,
    keepSolutions = 50,
  } = options;

  const assignment = new Map();
  const solutions = [];
  const metrics = {
    nodes: 0,
    checks: 0,
    conflicts: 0,
    backtracks: 0,
    deadEnds: 0,
    boundPrunes: 0,
    solutions: 0,
    depth: 0,
    maxDepth: 0,
  };
  let best = null;
  let bestCost = Infinity;
  let stop = false;
  const total = problem.variables.length;
  const label = (v, value) => problem.label ? problem.label(v, value) : (value === undefined ? String(v) : `${v} = ${value}`);

  function candidateCount(variable) {
    let count = 0;
    for (const value of problem.values(variable)) {
      metrics.checks++;
      if (!problem.check(variable, value, assignment)) count++;
    }
    return count;
  }

  function selectVariable() {
    let chosen = null;
    let chosenCount = Infinity;
    for (const v of problem.variables) {
      if (assignment.has(v)) continue;
      if (variableOrder !== 'mrv') return { variable: v, count: null };
      const count = candidateCount(v);
      if (count < chosenCount) {
        chosen = v;
        chosenCount = count;
        if (count === 0) break;
      }
    }
    return { variable: chosen, count: chosenCount };
  }

  function* search() {
    if (assignment.size === total) {
      metrics.solutions++;
      const snapshot = Object.fromEntries(assignment);
      if (mode === 'optimize') {
        const cost = problem.cost(assignment);
        const improved = cost < bestCost;
        if (improved) {
          bestCost = cost;
          best = snapshot;
        }
        if (trace) {
          yield makeEvent('solution', improved
            ? `Solución completa con coste ${cost}: nueva mejor solución.`
            : `Solución completa con coste ${cost}; no mejora la mejor (${bestCost}).`,
          { assignment: snapshot, cost, improved, best: improved }, metrics);
        }
      } else {
        if (solutions.length < keepSolutions) solutions.push(snapshot);
        if (trace) yield makeEvent('solution', `Solución completa nº ${metrics.solutions}.`, { assignment: snapshot }, metrics);
        if (metrics.solutions >= maxSolutions) stop = true;
      }
      return;
    }

    if (mode === 'optimize' && useBound && problem.lowerBound && best !== null) {
      const bound = problem.lowerBound(assignment);
      if (bound >= bestCost) {
        metrics.boundPrunes++;
        if (trace) {
          yield makeEvent('bound-prune', `Poda por cota: cualquier compleción costaría al menos ${bound}, y ya hay una solución de coste ${bestCost}.`, { bound, bestCost }, metrics);
        }
        return;
      }
    }

    const { variable, count } = selectVariable();
    if (trace) {
      yield makeEvent('select-variable', count === null
        ? `Se selecciona la siguiente variable en orden fijo: ${label(variable)}.`
        : `MRV: ${label(variable)} tiene ${count} candidato(s) consistente(s), el mínimo entre las variables libres.`,
      { variable, candidates: count, depth: assignment.size }, metrics);
    }

    let values = [...problem.values(variable)];
    if (valueOrder === 'heuristic' && problem.orderValues) values = problem.orderValues(variable, values, assignment);

    for (const value of values) {
      if (stop) return;
      if (trace) yield makeEvent('try-candidate', `Se prueba ${label(variable, value)}.`, { variable, value }, metrics);
      metrics.checks++;
      const conflict = problem.check(variable, value, assignment);
      if (conflict) {
        metrics.conflicts++;
        if (trace) {
          yield makeEvent('conflict', `Conflicto: ${label(variable, value)} ${conflict.reason}.`, { variable, value, conflicts: conflict.conflicts ?? [] }, metrics);
        }
        continue;
      }
      if (trace) yield makeEvent('check', `${label(variable, value)} cumple todas las restricciones con la asignación parcial.`, { variable, value }, metrics);

      assignment.set(variable, value);
      problem.assign?.(variable, value);
      metrics.nodes++;
      metrics.depth = assignment.size;
      if (metrics.depth > metrics.maxDepth) metrics.maxDepth = metrics.depth;
      if (trace) yield makeEvent('assign', `Asignación ${label(variable, value)}.`, { variable, value, depth: assignment.size }, metrics);
      if (trace && assignment.size < total) {
        yield makeEvent('advance', `Se avanza al nivel ${assignment.size + 1} de ${total}.`, { depth: assignment.size }, metrics);
      }

      yield* search();
      // Al detenerse se conserva la asignación para que la vista muestre la solución.
      if (stop) return;

      assignment.delete(variable);
      problem.unassign?.(variable, value);
      metrics.backtracks++;
      metrics.depth = assignment.size;
      if (trace) yield makeEvent('backtrack', `Retroceso: se deshace ${label(variable, value)}.`, { variable, value, depth: assignment.size }, metrics);
    }
    metrics.deadEnds++;
    if (trace && !stop) {
      yield makeEvent('dead-end', `No quedan candidatos para ${label(variable)}: hay que retroceder.`, { variable }, metrics);
    }
  }

  if (trace) yield makeEvent('start', `Inicio de la búsqueda con ${total} variables.`, { variables: total }, metrics);
  yield* search();
  const complete = !stop;
  if (trace) {
    const summary = mode === 'optimize'
      ? (best ? `Búsqueda terminada. Coste óptimo: ${bestCost}.` : 'Búsqueda terminada: no existe ninguna asignación válida.')
      : (metrics.solutions === 0
        ? 'Búsqueda exhaustiva terminada: no existe ninguna solución.'
        : (complete ? `Búsqueda exhaustiva terminada: ${metrics.solutions} solución(es).` : `Búsqueda detenida tras ${metrics.solutions} solución(es) (límite alcanzado).`));
    yield makeEvent('finished', summary, { complete, solutions: metrics.solutions }, metrics);
  }
  return {
    solutions,
    solutionCount: metrics.solutions,
    complete,
    best,
    bestCost: best ? bestCost : null,
    metrics: { ...metrics },
  };
}
