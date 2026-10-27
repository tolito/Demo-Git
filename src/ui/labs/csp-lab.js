import { now, runToCompletion } from '../../core/trace.js';
import { CSP_PRESETS, solveCSP } from '../../algorithms/csp/solver.js';
import { verifySolution } from '../../algorithms/csp/csp.js';
import {
  AUSTRALIA, COLOR_NAMES, K4, TASK_CSP_IMPOSSIBLE, TASK_CSP_INSTANCE, graphColoringCSP, randomGraph, sudokuCSP, taskAssignmentCSP,
} from '../../algorithms/csp/problems.js';
import { SUDOKU_EXAMPLES, parseSudoku } from '../../algorithms/backtracking/sudoku.js';
import { cspModel } from '../../visualization/models.js';
import { formatMs, formatNumber } from '../../utils/format.js';
import { checkbox, clear, field, guard, h, numberInput, readInt, select, showMessage, svg, yieldToUI } from '../dom.js';
import { createLabLayout, legend, paramGroup, table } from '../components/lab-layout.js';
import { createRunPanel } from '../components/run-session.js';

const METRIC_LABELS = {
  nodes: 'Asignaciones (nodos)',
  checks: 'Comprobaciones de restricciones',
  conflicts: 'Conflictos',
  backtracks: 'Retrocesos',
  prunes: 'Valores eliminados',
  revisions: 'Revisiones AC-3',
  arcsProcessed: 'Arcos procesados',
  wipeouts: 'Dominios vaciados',
  solutions: 'Soluciones',
};

const EVENT_LABELS = {
  start: 'inicio', 'ac3-start': 'AC-3 inicio', 'ac3-revise': 'AC-3 revisa', 'ac3-end': 'AC-3 fin', 'domain-wipeout': 'dominio vacío',
  'select-variable': 'variable', 'order-values': 'LCV', 'try-value': 'valor', conflict: 'conflicto', assign: 'asignación',
  prune: 'forward check', restrict: 'MAC reduce', restore: 'restaurar', backtrack: 'retroceso', 'dead-end': 'sin valores',
  solution: 'solución', finished: 'fin',
};

const GRAPH_COLORS = ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#fb8c00'];

const PROBLEMS = [
  { id: 'australia', label: 'Coloreado: mapa de Australia (3 colores)' },
  { id: 'k4', label: 'Coloreado: K4 con 3 colores (sin solución)' },
  { id: 'random', label: 'Coloreado: grafo aleatorio' },
  { id: 'sudoku', label: 'Sudoku como CSP' },
  { id: 'tasks', label: 'Asignación de tareas (con solución)' },
  { id: 'tasks-impossible', label: 'Asignación de tareas (sin solución)' },
];

export const cspLab = {
  id: 'csp',
  title: 'Satisfacción de restricciones',
  navTitle: 'CSP',
  summary: 'Motor CSP con MRV, grado, LCV, forward checking y AC-3, aplicado a coloreado de grafos, Sudoku y asignación de tareas.',
  highlights: ['Dominios que se reducen en tiempo real', 'Activa o desactiva cada heurística', 'Detección de inconsistencias'],
  mount(container) {
    const help = [
      h('p', {}, 'Un CSP se define con variables, dominios y restricciones. La búsqueda asigna variables una a una; la inferencia elimina de los dominios de las variables libres los valores que ya no pueden formar parte de una solución.'),
      h('p', {}, h('strong', {}, 'MRV'), ' elige la variable con menos valores restantes; ', h('strong', {}, 'grado'), ' desempata por número de restricciones con variables libres; ', h('strong', {}, 'LCV'), ' prueba primero el valor que menos valores elimina a los vecinos.'),
      h('p', {}, h('strong', {}, 'Forward checking'), ' poda los dominios de los vecinos tras cada asignación. ', h('strong', {}, 'AC-3'), ' hace consistentes todos los arcos binarios (cada valor tiene soporte en el vecino). AC-3 puede detectar inconsistencias, pero un problema arco-consistente puede seguir sin solución (por ejemplo K4 con 3 colores): por eso se combina con la búsqueda. MAC ejecuta AC-3 tras cada asignación.'),
      h('p', {}, 'Las restricciones n-arias (capacidad de un agente) no se propagan con AC-3; se comprueban al asignar y con forward checking.'),
    ];
    const layout = createLabLayout({ title: this.title, summary: this.summary, help });
    container.append(layout.root);

    const problemSelect = select(PROBLEMS.map((p) => ({ value: p.id, label: p.label })), 'australia', () => { updateProblemFields(); prepare(); });
    const seedInput = numberInput(3, { min: 0, max: 999999999, onchange: () => prepare() });
    const nodesInput = numberInput(14, { min: 3, max: 40, onchange: () => prepare() });
    const colorsInput = numberInput(4, { min: 1, max: COLOR_NAMES.length, onchange: () => prepare() });
    const sudokuSelect = select(SUDOKU_EXAMPLES.filter((e) => e.id !== 'invalid').map((e) => ({ value: e.id, label: e.name })), 'easy', () => prepare());
    const randomFields = h('div', {}, h('div', { class: 'inline-fields' }, field('Semilla', seedInput), field('Nodos', nodesInput)), field('Colores', colorsInput));
    const sudokuFields = h('div', {}, field('Tablero', sudokuSelect));

    const opts = { mrv: true, degree: true, lcv: false, inference: 'fc', ac3: false };
    const checks = {
      mrv: checkbox('MRV (mínimos valores restantes)', opts.mrv, (v) => { opts.mrv = v; prepare(); }),
      degree: checkbox('Grado (desempate)', opts.degree, (v) => { opts.degree = v; prepare(); }),
      lcv: checkbox('LCV (valor menos restrictivo)', opts.lcv, (v) => { opts.lcv = v; prepare(); }),
      ac3: checkbox('AC-3 como preprocesado', opts.ac3, (v) => { opts.ac3 = v; prepare(); }),
    };
    const inferenceSelect = select([
      { value: 'none', label: 'Ninguna (solo comprobar)' },
      { value: 'fc', label: 'Forward checking' },
      { value: 'mac', label: 'MAC (forward checking + AC-3)' },
    ], opts.inference, (v) => { opts.inference = v; prepare(); });
    const maxSolutionsInput = numberInput(1, { min: 1, max: 100000, onchange: () => prepare() });

    layout.params.append(
      paramGroup('Problema', field('Problema', problemSelect), randomFields, sudokuFields),
      paramGroup('Heurísticas e inferencia', checks.mrv, checks.degree, checks.lcv, field('Inferencia', inferenceSelect), checks.ac3,
        field('Soluciones a buscar', maxSolutionsInput, 'Con más de 1, la búsqueda continúa tras cada solución.')),
      paramGroup('Comparar', h('button', { type: 'button', class: 'btn', onclick: () => guard(layout.messages, compare) }, 'Comparar configuraciones')),
    );

    const viewBox = h('div');
    const domainsBox = h('div');
    const resultBox = h('div');
    layout.visual.append(viewBox, resultBox, h('h3', {}, 'Dominios'), domainsBox);

    const panel = createRunPanel({ metricLabels: METRIC_LABELS, eventTypeLabels: EVENT_LABELS, onRender: (state, controller) => render(state, controller) });
    layout.side.append(panel.controlsElement, panel.metricsElement);
    layout.below.append(panel.logElement);
    const compareBox = h('section', { class: 'panel' }, h('h3', {}, 'Comparación de configuraciones'), h('p', { class: 'muted' }, 'Ejecuta las cuatro configuraciones predefinidas sobre el mismo problema.'));
    layout.below.append(compareBox);

    let csp = null;

    function buildCSP() {
      switch (problemSelect.value) {
        case 'australia': return graphColoringCSP({ ...AUSTRALIA, colors: 3 });
        case 'k4': return graphColoringCSP({ ...K4, colors: 3 });
        case 'random': {
          const g = randomGraph(readInt(seedInput, 'La semilla', 0, 999999999), { nodes: readInt(nodesInput, 'Los nodos', 3, 40) });
          return graphColoringCSP({ ...g, colors: readInt(colorsInput, 'Los colores', 1, COLOR_NAMES.length) });
        }
        case 'sudoku': return sudokuCSP(parseSudoku(SUDOKU_EXAMPLES.find((e) => e.id === sudokuSelect.value).board));
        case 'tasks': return taskAssignmentCSP(TASK_CSP_INSTANCE);
        case 'tasks-impossible': return taskAssignmentCSP(TASK_CSP_IMPOSSIBLE);
        default: throw new Error('Problema desconocido');
      }
    }

    function updateProblemFields() {
      randomFields.hidden = problemSelect.value !== 'random';
      sudokuFields.hidden = problemSelect.value !== 'sudoku';
    }

    function prepare() {
      showMessage(layout.messages, null);
      try {
        csp = buildCSP();
        const maxSolutions = readInt(maxSolutionsInput, 'Las soluciones a buscar', 1, 100000);
        const options = { ...opts, maxSolutions };
        const problem = csp;
        panel.load({ createRun: () => solveCSP(problem, options), model: cspModel(problem), maxEvents: 250000, checkpointInterval: problem.variables.length > 50 ? 300 : 500 });
      } catch (error) {
        panel.unload();
        showMessage(layout.messages, error.message, 'error');
      }
    }

    function render(state, controller) {
      if (!csp) return;
      clear(viewBox);
      const kind = csp.meta.kind;
      if (kind === 'graph') viewBox.append(renderGraph(csp, state));
      else if (kind === 'sudoku') viewBox.append(renderSudoku(csp, state));
      else viewBox.append(h('p', { class: 'muted' }, 'Variables = tareas; dominio = agentes con la habilidad requerida (restricción unaria). Restricciones: incompatibilidades (≠), tareas que van juntas (=) y capacidad de cada agente (n-aria).'));
      clear(domainsBox);
      if (kind !== 'sudoku' && state) domainsBox.append(renderDomains(csp, state));
      else if (kind === 'sudoku') domainsBox.append(h('p', { class: 'muted' }, 'En el Sudoku, los candidatos de cada celda vacía se muestran dentro del tablero (los eliminados aparecen tachados).'));
      clear(resultBox);
      if (controller?.isComplete && controller.result) {
        const r = controller.result;
        if (r.inconsistentBeforeSearch) resultBox.append(h('div', { class: 'notice notice-warn' }, 'Inconsistencia detectada antes de buscar (un dominio quedó vacío): el problema no tiene solución.'));
        else if (r.solutionCount === 0) resultBox.append(h('div', { class: 'notice notice-warn' }, `Búsqueda exhaustiva: el problema no tiene solución (${formatNumber(r.metrics.nodes)} asignaciones exploradas).`));
        else {
          const valid = r.solutions.every((s) => verifySolution(csp, s).valid);
          resultBox.append(h('div', { class: 'notice notice-ok' }, `${r.solutionCount} solución(es) encontrada(s)${r.exhausted ? ' (búsqueda exhaustiva: es el total)' : ''}. Verificación independiente de todas las restricciones: ${valid ? 'correcta' : 'FALLIDA'}.`));
        }
      }
    }

    let compareToken = 0;
    async function compare() {
      const token = ++compareToken;
      const rows = [];
      // Límite de nodos para que la configuración básica no bloquee la interfaz
      // en problemas grandes (p. ej. Sudoku difícil sin heurísticas).
      const limit = 100000;
      clear(compareBox).append(h('h3', {}, 'Comparación (primera solución)'), h('p', { class: 'muted' }, 'Ejecutando…'));
      for (const preset of Object.values(CSP_PRESETS)) {
        await yieldToUI();
        if (token !== compareToken || !compareBox.isConnected) return;
        const problem = buildCSP();
        const t0 = now();
        const { result } = runToCompletion(solveCSP(problem, { ...preset.options, maxSolutions: 1, trace: false, maxNodes: limit }));
        rows.push({
          name: preset.name,
          solved: result.limitReached ? `límite (${formatNumber(limit)} nodos)` : result.solutionCount ? 'Sí' : 'No existe',
          nodes: result.metrics.nodes,
          checks: result.metrics.checks,
          backtracks: result.metrics.backtracks,
          prunes: result.metrics.prunes,
          revisions: result.metrics.revisions,
          time: now() - t0,
        });
      }
      clear(compareBox).append(h('h3', {}, 'Comparación (primera solución)'), table([
        { key: 'name', label: 'Configuración' },
        { key: 'solved', label: '¿Solución?' },
        { key: 'nodes', label: 'Asignaciones', format: (v) => formatNumber(v) },
        { key: 'checks', label: 'Comprobaciones', format: (v) => formatNumber(v) },
        { key: 'backtracks', label: 'Retrocesos', format: (v) => formatNumber(v) },
        { key: 'prunes', label: 'Valores podados', format: (v) => formatNumber(v) },
        { key: 'revisions', label: 'Revisiones AC-3', format: (v) => formatNumber(v) },
        { key: 'time', label: 'Tiempo (1 ejec.)', format: (v) => formatMs(v) },
      ], rows), h('p', { class: 'hint' }, 'Las comprobaciones incluyen las que hacen MRV, LCV y la propagación: así se ve el coste real de cada heurística, no solo los nodos ahorrados.'));
    }

    updateProblemFields();
    prepare();
    return () => {
      compareToken++;
      panel.dispose();
    };
  },
};

function renderGraph(csp, state) {
  const { nodes, edges, positions } = csp.meta;
  const W = 600;
  const H = 420;
  const P = 34;
  const xy = (n) => [P + positions[n][0] * (W - 2 * P), P + positions[n][1] * (H - 2 * P)];
  const conflictPairs = new Set();
  if (state?.conflict) for (const w of state.conflict.with) conflictPairs.add([state.conflict.variable, w].sort().join('|'));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'graph-svg', role: 'img', 'aria-label': 'Grafo con la asignación de colores actual' });
  for (const [a, b] of edges) {
    const [x1, y1] = xy(a);
    const [x2, y2] = xy(b);
    const conflict = conflictPairs.has([a, b].sort().join('|'));
    root.append(svg('line', { x1, y1, x2, y2, class: `gedge${conflict ? ' conflict' : ''}` }));
  }
  for (const n of nodes) {
    const [x, y] = xy(n);
    let value = state?.assignment.get(n);
    let tentative = false;
    if (value === undefined && state?.trying?.variable === n) {
      value = state.trying.value;
      tentative = true;
    }
    const classes = ['gnode'];
    if (state?.current === n) classes.push('current');
    if (state?.wipeout === n) classes.push('wipeout');
    const domain = state ? [...state.domains.get(n)].sort((p, q) => p - q) : csp.domains.get(n);
    root.append(svg('g', { class: classes.join(' ') },
      svg('circle', { cx: x, cy: y, r: 20, style: value !== undefined ? `fill:${GRAPH_COLORS[value]};${tentative ? 'fill-opacity:.45' : ''}` : '' }),
      svg('text', { x, y }, n),
      svg('text', { x, y: y + 30, class: 'dom' }, `{${domain.map((v) => COLOR_NAMES[v].slice(0, 2)).join(',')}}`)));
  }
  return h('div', {}, root, legend(COLOR_NAMES.slice(0, Math.max(...csp.variables.map((v) => csp.domains.get(v).length))).map((c, i) => ({ color: GRAPH_COLORS[i], label: c }))));
}

function renderSudoku(csp, state) {
  const grid = h('div', { class: 'sudoku', role: 'grid', 'aria-label': 'Sudoku como CSP' });
  const given = csp.meta.board;
  for (let i = 0; i < 81; i++) {
    const v = csp.variables[i];
    const r = Math.floor(i / 9);
    const c = i % 9;
    const classes = ['sudoku-cell'];
    if (c % 3 === 2 && c < 8) classes.push('box-r');
    if (r % 3 === 2 && r < 8) classes.push('box-b');
    let content;
    if (given[i]) {
      classes.push('given');
      content = String(given[i]);
    } else if (state?.assignment.has(v)) {
      classes.push('assigned');
      content = String(state.assignment.get(v));
    } else {
      const domain = state ? state.domains.get(v) : new Set(csp.domains.get(v));
      content = h('div', { class: 'candidates', 'aria-label': `candidatos ${[...domain].join(',')}` },
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => h('span', { class: domain.has(d) ? '' : 'removed' }, String(d))));
    }
    if (state?.current === v) classes.push('current');
    if (state?.trying?.variable === v) classes.push('trying');
    if (state?.wipeout === v) classes.push('wipeout');
    if (state?.changed.some((ch) => ch.variable === v)) classes.push('peer-conflict');
    grid.append(h('div', { class: classes.join(' '), role: 'gridcell' }, content));
  }
  return h('div', {}, h('div', { class: 'board-wrap' }, grid),
    legend([{ className: 'sw-assigned', label: 'Asignada' }, { className: 'sw-trying', label: 'Variable actual' }, { className: 'sw-conflict', label: 'Dominio modificado en este paso' }]));
}

function renderDomains(csp, state) {
  const fmt = csp.meta.formatValue ?? String;
  const label = csp.meta.taskName ?? String;
  const changedRemoved = new Map();
  const changedRestored = new Map();
  for (const ch of state.changed) {
    if (ch.removed) changedRemoved.set(ch.variable, new Set(ch.removed));
    if (ch.restored) {
      if (!changedRestored.has(ch.variable)) changedRestored.set(ch.variable, new Set());
      for (const x of ch.restored) changedRestored.get(ch.variable).add(x);
    }
  }
  const box = h('div', { class: 'domain-table' });
  for (const v of csp.variables) {
    const current = state.domains.get(v);
    const classes = ['domain-var'];
    if (state.current === v) classes.push('current');
    if (state.wipeout === v) classes.push('wipeout');
    box.append(h('span', { class: classes.join(' ') }, `${label(v)}${state.assignment.has(v) ? ` = ${fmt(state.assignment.get(v))}` : ''}`),
      h('span', { class: 'chips' }, csp.domains.get(v).map((x) => {
        const c = ['chip'];
        if (!current.has(x)) c.push('removed');
        if (state.assignment.get(v) === x) c.push('assigned');
        if (changedRemoved.get(v)?.has(x)) c.push('just-removed');
        if (changedRestored.get(v)?.has(x)) c.push('just-restored');
        return h('span', { class: c.join(' ') }, fmt(x));
      })));
  }
  return box;
}
