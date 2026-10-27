/**
 * Modelo de problema de satisfacción de restricciones (CSP).
 *
 * - variables: identificadores (cadenas o números).
 * - domains: Map variable -> array de valores (orden natural).
 * - constraints: lista de restricciones. Cada una tiene:
 *     scope: variables implicadas.
 *     isSatisfied(assignment: Map): false solo si la asignación parcial ya viola
 *         la restricción; si faltan variables necesarias debe devolver true.
 *     binary (opcional): (a, b) => bool para restricciones binarias; permite
 *         AC-3 y forward checking eficientes.
 *     label: descripción legible.
 */

export function binaryConstraint(a, b, predicate, label) {
  if (a === b) throw new Error('Una restricción binaria necesita dos variables distintas.');
  return {
    scope: [a, b],
    label,
    binary: { a, b, predicate },
    isSatisfied(assignment) {
      if (!assignment.has(a) || !assignment.has(b)) return true;
      return predicate(assignment.get(a), assignment.get(b));
    },
  };
}

export function notEqual(a, b, label = `${a} ≠ ${b}`) {
  return binaryConstraint(a, b, (x, y) => x !== y, label);
}

/**
 * Restricción n-aria definida por un predicado sobre la asignación parcial.
 * AC-3 no la propaga (solo trabaja con arcos binarios); se comprueba al asignar
 * y en forward checking.
 */
export function naryConstraint(scope, isSatisfied, label) {
  return { scope: [...scope], label, isSatisfied };
}

export function createCSP({ name = 'CSP', variables, domains, constraints = [], meta = {} }) {
  const vars = [...variables];
  const varSet = new Set(vars);
  if (varSet.size !== vars.length) throw new Error('Hay variables repetidas en el CSP.');
  const domainMap = new Map();
  for (const v of vars) {
    const d = domains instanceof Map ? domains.get(v) : domains[v];
    if (!Array.isArray(d)) throw new Error(`La variable ${v} no tiene dominio.`);
    domainMap.set(v, [...d]);
  }
  const byVariable = new Map(vars.map((v) => [v, []]));
  const neighbors = new Map(vars.map((v) => [v, new Set()]));
  // arcs: Map "xi" -> Map "xj" -> lista de predicados (xi, xj)
  const binaryBetween = new Map(vars.map((v) => [v, new Map()]));
  for (const c of constraints) {
    for (const v of c.scope) {
      if (!varSet.has(v)) throw new Error(`La restricción "${c.label}" usa una variable desconocida: ${v}`);
      byVariable.get(v).push(c);
    }
    for (const v of c.scope) for (const w of c.scope) if (v !== w) neighbors.get(v).add(w);
    if (c.binary) {
      const { a, b, predicate } = c.binary;
      if (!binaryBetween.get(a).has(b)) binaryBetween.get(a).set(b, []);
      if (!binaryBetween.get(b).has(a)) binaryBetween.get(b).set(a, []);
      binaryBetween.get(a).get(b).push((x, y) => predicate(x, y));
      binaryBetween.get(b).get(a).push((y, x) => predicate(x, y));
    }
  }
  return {
    name,
    variables: vars,
    domains: domainMap,
    constraints,
    constraintsOf: (v) => byVariable.get(v),
    neighborsOf: (v) => neighbors.get(v),
    /** Predicados binarios entre xi y xj, expresados como f(valorXi, valorXj). */
    binaryPredicates: (xi, xj) => binaryBetween.get(xi).get(xj) ?? [],
    binaryNeighbors: (v) => binaryBetween.get(v).keys(),
    meta,
  };
}

/** Comprueba una asignación completa contra todas las restricciones. */
export function verifySolution(csp, solution) {
  const assignment = solution instanceof Map ? solution : new Map(Object.entries(solution).map(([k, v]) => [restoreKey(csp, k), v]));
  for (const v of csp.variables) {
    if (!assignment.has(v)) return { valid: false, reason: `Falta la variable ${v}.` };
    if (!csp.domains.get(v).includes(assignment.get(v))) return { valid: false, reason: `El valor de ${v} no pertenece a su dominio.` };
  }
  for (const c of csp.constraints) {
    if (!c.isSatisfied(assignment)) return { valid: false, reason: `Se viola la restricción ${c.label}.` };
  }
  return { valid: true };
}

function restoreKey(csp, key) {
  // Las claves de los objetos son cadenas; si las variables eran números se recuperan.
  if (csp.variables.includes(key)) return key;
  const n = Number(key);
  return csp.variables.includes(n) ? n : key;
}
