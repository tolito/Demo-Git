import { makeEvent } from '../../core/trace.js';

/**
 * Resolución de CSP por búsqueda con vuelta atrás + inferencia opcional.
 *
 * Opciones:
 *   mrv: elegir la variable con menos valores restantes.
 *   degree: desempate (o criterio único) por mayor número de restricciones
 *           con variables sin asignar.
 *   lcv: ordenar valores por el número de valores que eliminarían de los
 *        dominios de los vecinos (menos restrictivo primero).
 *   inference: 'none' | 'fc' (forward checking) | 'mac' (forward checking +
 *              mantener consistencia de arcos con AC-3 tras cada asignación).
 *   ac3: ejecutar AC-3 como preprocesado antes de la búsqueda.
 *   maxSolutions, maxNodes, trace.
 *
 * AC-3 por sí solo no resuelve el CSP: elimina valores sin soporte en los
 * arcos binarios. Puede detectar inconsistencia (dominio vacío), pero un
 * problema arco-consistente puede seguir sin solución, por eso se combina con
 * la búsqueda. Las restricciones n-arias no se propagan con AC-3.
 */
export function* solveCSP(csp, options = {}) {
  const {
    mrv = false,
    degree = false,
    lcv = false,
    inference = 'none',
    ac3: ac3Preprocess = false,
    maxSolutions = 1,
    maxNodes = Infinity,
    trace = true,
    keepSolutions = 20,
    propagateOnly = false,
  } = options;
  if (!['none', 'fc', 'mac'].includes(inference)) throw new Error(`Inferencia desconocida: ${inference}`);

  const variables = csp.variables;
  const index = new Map(variables.map((v, i) => [v, i]));
  const N = variables.length;
  const domains = new Map(variables.map((v) => [v, new Set(csp.domains.get(v))]));
  const assignment = new Map();
  const trail = [];
  const solutions = [];
  const metrics = {
    nodes: 0,
    checks: 0,
    conflicts: 0,
    backtracks: 0,
    prunes: 0,
    revisions: 0,
    arcsProcessed: 0,
    wipeouts: 0,
    solutions: 0,
  };
  let stop = false;
  let limitReached = false;

  const fmt = (v, value) => (value === undefined ? `${v}` : `${v} = ${csp.meta.formatValue ? csp.meta.formatValue(value) : value}`);
  const fmtValues = (values) => values.map((x) => (csp.meta.formatValue ? csp.meta.formatValue(x) : x)).join(', ');

  function currentValues(v) {
    const d = domains.get(v);
    return csp.domains.get(v).filter((x) => d.has(x));
  }

  function remove(v, value, countAsPrune = true) {
    domains.get(v).delete(value);
    trail.push([v, value]);
    if (countAsPrune) metrics.prunes++;
  }

  function undoTo(mark) {
    const restored = [];
    while (trail.length > mark) {
      const [v, value] = trail.pop();
      domains.get(v).add(value);
      restored.push([v, value]);
    }
    return restored;
  }

  /** Primera restricción violada por variable = value con la asignación actual. */
  function firstViolation(variable, value) {
    const hadValue = assignment.has(variable);
    const previous = assignment.get(variable);
    assignment.set(variable, value);
    let violated = null;
    for (const c of csp.constraintsOf(variable)) {
      metrics.checks++;
      if (!c.isSatisfied(assignment)) {
        violated = c;
        break;
      }
    }
    if (hadValue) assignment.set(variable, previous);
    else assignment.delete(variable);
    return violated;
  }

  function remainingValues(v) {
    if (inference !== 'none') return domains.get(v).size;
    // Sin inferencia los dominios no se reducen: se cuentan los valores legales.
    let count = 0;
    for (const x of currentValues(v)) if (!firstViolation(v, x)) count++;
    return count;
  }

  function unassignedDegree(v) {
    let count = 0;
    for (const w of csp.neighborsOf(v)) if (!assignment.has(w)) count++;
    return count;
  }

  function selectVariable() {
    let best = null;
    let bestRemaining = Infinity;
    let bestDegree = -1;
    for (const v of variables) {
      if (assignment.has(v)) continue;
      if (!mrv && !degree) return { variable: v, reason: 'orden fijo' };
      const remaining = mrv ? remainingValues(v) : null;
      const deg = degree ? unassignedDegree(v) : null;
      let better = false;
      if (best === null) better = true;
      else if (mrv && remaining < bestRemaining) better = true;
      else if ((!mrv || remaining === bestRemaining) && degree && deg > bestDegree) better = true;
      if (better) {
        best = v;
        bestRemaining = remaining;
        bestDegree = deg;
      }
    }
    const parts = [];
    if (mrv) parts.push(`MRV: ${bestRemaining} valor(es) restante(s)`);
    if (degree) parts.push(`grado: ${bestDegree} restricción(es) con variables libres`);
    return { variable: best, remaining: mrv ? bestRemaining : null, degree: degree ? bestDegree : null, reason: parts.join('; ') };
  }

  function orderValuesLCV(variable, values) {
    const scored = values.map((value, position) => {
      let eliminated = 0;
      for (const w of csp.binaryNeighbors(variable)) {
        if (assignment.has(w)) continue;
        const preds = csp.binaryPredicates(variable, w);
        for (const y of domains.get(w)) {
          metrics.checks++;
          if (!preds.every((p) => p(value, y))) eliminated++;
        }
      }
      return { value, eliminated, position };
    });
    scored.sort((a, b) => a.eliminated - b.eliminated || a.position - b.position);
    return scored;
  }

  function* revise(xi, xj) {
    metrics.revisions++;
    const preds = csp.binaryPredicates(xi, xj);
    const removed = [];
    const dj = currentValues(xj);
    for (const x of currentValues(xi)) {
      let supported = false;
      for (const y of dj) {
        metrics.checks++;
        if (preds.every((p) => p(x, y))) {
          supported = true;
          break;
        }
      }
      if (!supported) {
        remove(xi, x);
        removed.push(x);
      }
    }
    if (removed.length && trace) {
      yield makeEvent('ac3-revise',
        `AC-3 revisa el arco (${xi}, ${xj}): se eliminan de ${xi} los valores sin soporte en ${xj}: {${fmtValues(removed)}}.`,
        { variable: xi, against: xj, removed }, metrics);
    }
    return removed.length > 0;
  }

  /** AC-3 sobre la cola de arcos dada. Devuelve false si algún dominio queda vacío. */
  function* ac3(arcs, phase) {
    const queue = [];
    const inQueue = new Set();
    const push = (xi, xj) => {
      const key = index.get(xi) * N + index.get(xj);
      if (!inQueue.has(key)) {
        inQueue.add(key);
        queue.push([xi, xj]);
      }
    };
    for (const [xi, xj] of arcs) push(xi, xj);
    if (trace) yield makeEvent('ac3-start', `AC-3 (${phase}) comienza con ${queue.length} arco(s) en la cola.`, { arcs: queue.length, phase }, metrics);
    let head = 0;
    while (head < queue.length) {
      const [xi, xj] = queue[head++];
      inQueue.delete(index.get(xi) * N + index.get(xj));
      metrics.arcsProcessed++;
      const changed = yield* revise(xi, xj);
      if (!changed) continue;
      if (domains.get(xi).size === 0) {
        metrics.wipeouts++;
        if (trace) yield makeEvent('domain-wipeout', `El dominio de ${xi} se ha quedado vacío: inconsistencia detectada por AC-3.`, { variable: xi }, metrics);
        return false;
      }
      for (const xk of csp.binaryNeighbors(xi)) {
        if (xk !== xj && !assignment.has(xk)) push(xk, xi);
      }
    }
    if (trace) yield makeEvent('ac3-end', `AC-3 (${phase}) termina: todos los arcos revisados son consistentes.`, { phase }, metrics);
    return true;
  }

  /**
   * Forward checking: para cada restricción de la variable recién asignada,
   * elimina de las variables libres de su ámbito los valores que ya la violan.
   */
  function* forwardCheck(variable) {
    for (const c of csp.constraintsOf(variable)) {
      for (const y of c.scope) {
        if (y === variable || assignment.has(y)) continue;
        const removed = [];
        for (const w of currentValues(y)) {
          assignment.set(y, w);
          metrics.checks++;
          const ok = c.isSatisfied(assignment);
          assignment.delete(y);
          if (!ok) {
            remove(y, w);
            removed.push(w);
          }
        }
        if (removed.length && trace) {
          yield makeEvent('prune', `Forward checking: ${c.label} elimina {${fmtValues(removed)}} del dominio de ${y}.`, { variable: y, removed, cause: variable }, metrics);
        }
        if (domains.get(y).size === 0) {
          metrics.wipeouts++;
          if (trace) yield makeEvent('domain-wipeout', `El dominio de ${y} se ha quedado vacío tras asignar ${variable}: hay que retroceder.`, { variable: y }, metrics);
          return false;
        }
      }
    }
    return true;
  }

  function* search() {
    if (assignment.size === N) {
      metrics.solutions++;
      const snapshot = Object.fromEntries(assignment);
      if (solutions.length < keepSolutions) solutions.push(snapshot);
      if (trace) yield makeEvent('solution', `Solución completa nº ${metrics.solutions}: todas las variables asignadas sin violar restricciones.`, { assignment: snapshot }, metrics);
      if (metrics.solutions >= maxSolutions) stop = true;
      return;
    }
    if (metrics.nodes >= maxNodes) {
      stop = true;
      limitReached = true;
      return;
    }
    const selection = selectVariable();
    const variable = selection.variable;
    if (trace) {
      yield makeEvent('select-variable', `Se selecciona ${variable} (${selection.reason}).`,
        { variable, remaining: selection.remaining, degree: selection.degree }, metrics);
    }
    let values = currentValues(variable);
    if (lcv && values.length > 1) {
      const scored = orderValuesLCV(variable, values);
      values = scored.map((s) => s.value);
      if (trace) {
        yield makeEvent('order-values', `LCV ordena los valores de ${variable}: ${scored.map((s) => `${csp.meta.formatValue ? csp.meta.formatValue(s.value) : s.value} (elimina ${s.eliminated})`).join(', ')}.`,
          { variable, order: scored.map((s) => ({ value: s.value, eliminated: s.eliminated })) }, metrics);
      }
    }
    for (const value of values) {
      if (stop) return;
      if (trace) yield makeEvent('try-value', `Se prueba ${fmt(variable, value)}.`, { variable, value }, metrics);
      const violated = firstViolation(variable, value);
      if (violated) {
        metrics.conflicts++;
        if (trace) {
          yield makeEvent('conflict', `Conflicto: ${fmt(variable, value)} viola ${violated.label}.`,
            { variable, value, constraint: violated.label, with: violated.scope.filter((v) => v !== variable && assignment.has(v)) }, metrics);
        }
        continue;
      }
      assignment.set(variable, value);
      metrics.nodes++;
      if (trace) yield makeEvent('assign', `Asignación ${fmt(variable, value)}.`, { variable, value, depth: assignment.size }, metrics);
      const mark = trail.length;
      let ok = true;
      if (inference === 'fc' || inference === 'mac') {
        ok = yield* forwardCheck(variable);
      }
      if (ok && inference === 'mac') {
        const others = currentValues(variable).filter((x) => x !== value);
        for (const x of others) remove(variable, x, false);
        if (others.length && trace) {
          yield makeEvent('restrict', `MAC: el dominio de ${variable} se reduce a {${fmtValues([value])}}.`, { variable, removed: others }, metrics);
        }
        // La cola inicial contiene los arcos (Xk, Y) de toda variable Y cuyo
        // dominio ha cambiado (la asignada y las podadas por forward checking).
        const changed = new Set([variable]);
        for (let t = mark; t < trail.length; t++) changed.add(trail[t][0]);
        const arcs = [];
        for (const y of changed) {
          for (const w of csp.binaryNeighbors(y)) if (!assignment.has(w)) arcs.push([w, y]);
        }
        ok = yield* ac3(arcs, `tras asignar ${variable}`);
      }
      if (ok) {
        yield* search();
        if (stop) return;
      }
      const restored = undoTo(mark);
      if (restored.length && trace) {
        yield makeEvent('restore', `Se restauran ${restored.length} valor(es) eliminados por la inferencia de ${fmt(variable, value)}.`, { restored }, metrics);
      }
      assignment.delete(variable);
      metrics.backtracks++;
      if (trace) yield makeEvent('backtrack', `Retroceso: se deshace ${fmt(variable, value)}.`, { variable, value }, metrics);
    }
    if (trace && !stop) yield makeEvent('dead-end', `No quedan valores para ${variable}.`, { variable }, metrics);
  }

  if (trace) {
    yield makeEvent('start', `Inicio: ${N} variables, ${csp.constraints.length} restricciones. Inferencia: ${inference === 'none' ? 'ninguna' : inference === 'fc' ? 'forward checking' : 'MAC (AC-3)'}.`, {}, metrics);
  }
  let consistent = true;
  // Dominios vacíos desde el principio.
  for (const v of variables) {
    if (domains.get(v).size === 0) {
      consistent = false;
      if (trace) yield makeEvent('domain-wipeout', `La variable ${v} tiene el dominio vacío desde el principio.`, { variable: v }, metrics);
      break;
    }
  }
  if (consistent && ac3Preprocess) {
    const arcs = [];
    for (const xi of variables) for (const xj of csp.binaryNeighbors(xi)) arcs.push([xi, xj]);
    consistent = yield* ac3(arcs, 'preprocesado');
  }
  if (consistent && !propagateOnly) yield* search();

  // exhausted: se recorrió todo el espacio (o se probó la inconsistencia), por lo
  // que solutionCount es el número total de soluciones.
  const result = {
    solutions,
    solutionCount: metrics.solutions,
    exhausted: !stop,
    limitReached,
    inconsistentBeforeSearch: !consistent,
    metrics: { ...metrics },
  };
  if (propagateOnly) {
    result.consistent = consistent;
    result.domains = new Map(variables.map((v) => [v, currentValues(v)]));
    return result;
  }
  if (trace) {
    let message;
    if (!consistent) message = 'El problema es inconsistente: no hay solución (detectado antes de buscar).';
    else if (limitReached) message = `Búsqueda detenida al alcanzar el límite de ${maxNodes} nodos.`;
    else if (metrics.solutions === 0) message = 'Búsqueda exhaustiva terminada: el CSP no tiene solución.';
    else if (stop) message = `Búsqueda detenida tras encontrar ${metrics.solutions} solución(es).`;
    else message = `Búsqueda exhaustiva terminada: ${metrics.solutions} solución(es).`;
    yield makeEvent('finished', message, { solutions: metrics.solutions }, metrics);
  }
  return result;
}

/**
 * Aplica solo AC-3 (sin búsqueda). Devuelve { consistent, domains } con los
 * dominios reducidos. Que sea consistente NO implica que el CSP tenga solución.
 */
export function* arcConsistency(csp, { trace = true } = {}) {
  return yield* solveCSP(csp, { ac3: true, propagateOnly: true, trace });
}

export const CSP_PRESETS = Object.freeze({
  basic: { id: 'basic', name: 'Backtracking básico', options: { mrv: false, degree: false, lcv: false, inference: 'none', ac3: false } },
  mrv: { id: 'mrv', name: 'MRV + grado', options: { mrv: true, degree: true, lcv: false, inference: 'none', ac3: false } },
  fc: { id: 'fc', name: 'MRV + grado + LCV + forward checking', options: { mrv: true, degree: true, lcv: true, inference: 'fc', ac3: false } },
  mac: { id: 'mac', name: 'AC-3 inicial + MAC + MRV + grado + LCV', options: { mrv: true, degree: true, lcv: true, inference: 'mac', ac3: true } },
});
