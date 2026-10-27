/**
 * Modelos de visualización: traducen eventos de los algoritmos a un estado
 * visual. No tocan el DOM, por lo que se pueden probar en Node.
 *
 * Cada modelo implementa { init(), apply(state, event), clone(state) } y se
 * usa con ExecutionController, que guarda puntos de control con clone().
 */

// ---------------------------------------------------------------- caminos

export const CELL = Object.freeze({ UNEXPLORED: 0, FRONTIER: 1, VISITED: 2 });

export function pathfindingModel(grid) {
  const size = grid.width * grid.height;
  return {
    init: () => ({
      cells: new Uint8Array(size),
      g: new Float32Array(size).fill(NaN),
      current: -1,
      path: null,
      outcome: null,
    }),
    apply(state, event) {
      const d = event.data;
      switch (event.type) {
        case 'discover':
        case 'repush':
          if (state.cells[d.index] !== CELL.VISITED) state.cells[d.index] = CELL.FRONTIER;
          if (d.g !== undefined) state.g[d.index] = d.g;
          break;
        case 'update':
          state.g[d.index] = d.g;
          break;
        case 'expand':
          state.cells[d.index] = CELL.VISITED;
          state.current = d.index;
          break;
        case 'skip':
          state.current = d.index;
          break;
        case 'path':
          state.path = d.path;
          state.outcome = 'found';
          break;
        case 'no-path':
          state.outcome = 'none';
          state.current = -1;
          break;
        default:
          break;
      }
    },
    clone: (s) => ({ cells: new Uint8Array(s.cells), g: new Float32Array(s.g), current: s.current, path: s.path, outcome: s.outcome }),
  };
}

// ----------------------------------------------------------- backtracking

export function backtrackingModel() {
  return {
    init: () => ({
      assignment: new Map(),
      current: null,
      trying: null,
      conflict: null,
      lastSolution: null,
      best: null,
      bestCost: null,
      solutions: 0,
      finished: false,
      deadEnd: null,
    }),
    apply(state, event) {
      const d = event.data;
      switch (event.type) {
        case 'select-variable':
          state.current = d.variable;
          state.trying = null;
          state.conflict = null;
          state.deadEnd = null;
          break;
        case 'try-candidate':
          state.trying = { variable: d.variable, value: d.value };
          state.conflict = null;
          break;
        case 'conflict':
          state.conflict = { variable: d.variable, value: d.value, with: d.conflicts };
          break;
        case 'check':
          state.conflict = null;
          break;
        case 'assign':
          state.assignment.set(d.variable, d.value);
          state.trying = null;
          break;
        case 'backtrack':
          state.assignment.delete(d.variable);
          state.current = d.variable;
          state.trying = null;
          state.conflict = null;
          break;
        case 'dead-end':
          state.deadEnd = d.variable;
          break;
        case 'solution':
          state.solutions++;
          state.lastSolution = d.assignment;
          if (d.improved) {
            state.best = d.assignment;
            state.bestCost = d.cost;
          }
          break;
        case 'finished':
          state.finished = true;
          state.trying = null;
          state.conflict = null;
          break;
        default:
          break;
      }
    },
    clone: (s) => ({ ...s, assignment: new Map(s.assignment) }),
  };
}

// --------------------------------------------------------------------- CSP

export function cspModel(csp) {
  return {
    init: () => ({
      domains: new Map(csp.variables.map((v) => [v, new Set(csp.domains.get(v))])),
      assignment: new Map(),
      current: null,
      trying: null,
      conflict: null,
      wipeout: null,
      changed: [],
      lastSolution: null,
      solutions: 0,
      finished: false,
    }),
    apply(state, event) {
      const d = event.data;
      state.changed = [];
      switch (event.type) {
        case 'select-variable':
          state.current = d.variable;
          state.trying = null;
          state.conflict = null;
          state.wipeout = null;
          break;
        case 'try-value':
          state.trying = { variable: d.variable, value: d.value };
          state.conflict = null;
          break;
        case 'conflict':
          state.conflict = { variable: d.variable, value: d.value, with: d.with, constraint: d.constraint };
          break;
        case 'assign':
          state.assignment.set(d.variable, d.value);
          state.trying = null;
          break;
        case 'ac3-revise':
        case 'prune':
        case 'restrict': {
          const domain = state.domains.get(d.variable);
          for (const value of d.removed) domain.delete(value);
          state.changed = [{ variable: d.variable, removed: d.removed }];
          break;
        }
        case 'restore':
          for (const [variable, value] of d.restored) state.domains.get(variable).add(value);
          state.changed = d.restored.map(([variable, value]) => ({ variable, restored: [value] }));
          state.wipeout = null;
          break;
        case 'domain-wipeout':
          state.wipeout = d.variable;
          break;
        case 'backtrack':
          state.assignment.delete(d.variable);
          state.current = d.variable;
          state.trying = null;
          state.conflict = null;
          break;
        case 'solution':
          state.solutions++;
          state.lastSolution = d.assignment;
          break;
        case 'finished':
          state.finished = true;
          break;
        default:
          break;
      }
    },
    clone: (s) => ({
      ...s,
      domains: new Map([...s.domains].map(([v, set]) => [v, new Set(set)])),
      assignment: new Map(s.assignment),
      changed: s.changed.slice(),
    }),
  };
}

// --------------------------------------------------------- árbol de juego

/**
 * Árbol de búsqueda minimax/alfa-beta. Para no saturar la vista solo se
 * guardan los primeros `maxNodes` nodos; el resto se cuenta en `hidden`.
 */
export function gameTreeModel({ maxNodes = 1500 } = {}) {
  return {
    init: () => ({ nodes: new Map(), rootId: null, current: null, hidden: 0, chosen: null, rootValue: null, rootExact: null }),
    apply(state, event) {
      const d = event.data;
      switch (event.type) {
        case 'enter': {
          if (d.parentId !== null && !state.nodes.has(d.parentId)) {
            state.hidden++;
            break;
          }
          if (state.nodes.size >= maxNodes) {
            state.hidden++;
            break;
          }
          state.nodes.set(d.id, {
            id: d.id,
            parentId: d.parentId,
            moveLabel: d.moveLabel,
            depth: d.depth,
            isMax: d.isMax,
            alpha: d.alpha,
            beta: d.beta,
            value: null,
            exact: null,
            leaf: false,
            status: 'active',
            bound: null,
            bestChild: null,
            children: [],
            pruned: [],
            board: d.state?.board ? d.state.board.slice() : null,
          });
          if (d.parentId === null) state.rootId = d.id;
          else state.nodes.get(d.parentId).children.push(d.id);
          state.current = d.id;
          break;
        }
        case 'leaf': {
          const node = state.nodes.get(d.id);
          if (!node) break;
          node.value = d.value;
          node.exact = d.exact;
          node.leaf = true;
          node.status = 'done';
          state.current = d.id;
          break;
        }
        case 'update': {
          const node = state.nodes.get(d.id);
          if (!node) break;
          node.value = d.value;
          node.alpha = d.alpha;
          node.beta = d.beta;
          if (d.improves) node.bestChild = d.childId;
          state.current = d.id;
          break;
        }
        case 'prune': {
          const node = state.nodes.get(d.id);
          if (!node) break;
          node.pruned = d.prunedLabels.slice();
          state.current = d.id;
          break;
        }
        case 'exit': {
          const node = state.nodes.get(d.id);
          if (!node) break;
          node.value = d.value;
          node.exact = d.exact;
          node.bound = d.bound;
          node.status = 'done';
          state.current = node.parentId ?? d.id;
          break;
        }
        case 'choose':
          state.chosen = state.nodes.get(d.id)?.bestChild ?? null;
          state.rootValue = d.value;
          state.rootExact = d.exact;
          state.current = d.id;
          break;
        default:
          break;
      }
    },
    clone: (s) => ({
      ...s,
      nodes: new Map([...s.nodes].map(([id, n]) => [id, { ...n, children: n.children.slice(), pruned: n.pruned.slice() }])),
    }),
  };
}

// ------------------------------------------------------------- genéticos

export function geneticModel() {
  return {
    init: () => ({ history: [], best: null, bestEver: null, population: null, crossover: null, mutation: null, stop: null }),
    apply(state, event) {
      const d = event.data;
      switch (event.type) {
        case 'generation':
          state.history.push({ generation: d.generation, best: d.best, mean: d.mean, worst: d.worst, std: d.std, diversity: d.diversity, bestEver: d.bestEver });
          state.best = d.bestIndividual;
          state.bestEver = d.bestEverIndividual;
          state.population = d.population;
          state.crossover = null;
          state.mutation = null;
          break;
        case 'crossover':
          state.crossover = d;
          break;
        case 'mutation':
          state.mutation = d;
          break;
        case 'stop':
          state.stop = d;
          break;
        default:
          break;
      }
    },
    clone: (s) => ({ ...s, history: s.history.slice() }),
  };
}
