import { now, runToCompletion } from '../../core/trace.js';
import {
  SUDOKU_EXAMPLES, cellName, countSolutions, formatSudoku, generateSudoku, parseSudoku, solveSudoku, validateSudoku,
} from '../../algorithms/backtracking/sudoku.js';
import { KNOWN_SOLUTION_COUNTS, MAX_QUEENS, solveNQueens } from '../../algorithms/backtracking/nqueens.js';
import {
  DEFAULT_INSTANCE, TASK_STRATEGIES, isValidAssignment, randomInstance, solveTaskAssignment,
} from '../../algorithms/backtracking/task-assignment.js';
import { backtrackingModel } from '../../visualization/models.js';
import { formatMs, formatNumber } from '../../utils/format.js';
import { clear, field, guard, h, numberInput, readInt, select, showMessage } from '../dom.js';
import { createLabLayout, legend, paramGroup, table, tabs } from '../components/lab-layout.js';
import { createRunPanel } from '../components/run-session.js';

const METRIC_LABELS = {
  nodes: 'Asignaciones (nodos)',
  checks: 'Comprobaciones',
  conflicts: 'Conflictos',
  backtracks: 'Retrocesos',
  deadEnds: 'Callejones sin salida',
  boundPrunes: 'Podas por cota',
  solutions: 'Soluciones',
  depth: 'Profundidad actual',
  maxDepth: 'Profundidad máxima',
};

const EVENT_LABELS = {
  start: 'inicio', 'select-variable': 'variable', 'try-candidate': 'candidato', check: 'comprobación', conflict: 'conflicto',
  assign: 'asignación', advance: 'avance', backtrack: 'retroceso', 'dead-end': 'sin valores', solution: 'solución',
  'bound-prune': 'poda cota', finished: 'fin',
};

export const backtrackingLab = {
  id: 'backtracking',
  title: 'Backtracking',
  summary: 'Motor genérico de vuelta atrás aplicado a Sudoku, N reinas y asignación de tareas con costes.',
  highlights: ['Sudoku con detección de soluciones múltiples', 'N reinas con recuento de soluciones', 'Asignación de tareas: búsqueda simple vs. MRV + cota'],
  mount(container) {
    const help = [
      h('p', {}, 'Todos los problemas usan el mismo motor: selecciona una variable libre, prueba sus candidatos, comprueba las restricciones contra la asignación parcial, asigna y avanza; si no quedan candidatos, retrocede deshaciendo la última asignación.'),
      h('p', {}, h('strong', {}, 'MRV '), '(mínimos valores restantes) elige la variable con menos candidatos consistentes. Para calcularlo el motor hace comprobaciones adicionales, que también se cuentan en las métricas.'),
      h('p', {}, 'En modo «contar soluciones» la búsqueda continúa tras cada solución hasta agotar el espacio o alcanzar el límite indicado. Un Sudoku solo se etiqueta como de solución única si la búsqueda exhaustiva encuentra exactamente una.'),
    ];
    const layout = createLabLayout({ title: this.title, summary: this.summary, help });
    container.append(layout.root);
    const tabBar = h('div');
    layout.root.insertBefore(tabBar, layout.messages);

    let active = 'sudoku';
    let view = null;
    const panel = createRunPanel({
      metricLabels: METRIC_LABELS,
      eventTypeLabels: EVENT_LABELS,
      onRender: (state, controller) => view?.render(state, controller),
    });
    layout.side.append(panel.controlsElement, panel.metricsElement);
    layout.below.append(panel.logElement);
    const extra = h('section', { class: 'panel' });
    layout.below.append(extra);

    const views = { sudoku: sudokuView, nqueens: queensView, tasks: tasksView };

    function show(id) {
      active = id;
      clear(tabBar).append(tabs([
        { id: 'sudoku', label: 'Sudoku' },
        { id: 'nqueens', label: 'N reinas' },
        { id: 'tasks', label: 'Asignación de tareas' },
      ], active, show));
      panel.unload();
      clear(layout.params);
      clear(layout.visual);
      clear(extra);
      showMessage(layout.messages, null);
      view = views[id]({ params: layout.params, visual: layout.visual, extra, panel, messages: layout.messages });
      view.prepare();
    }
    show(active);

    return () => panel.dispose();
  },
};

// =================================================================== Sudoku

function sudokuView({ params, visual, extra, panel, messages }) {
  let board = parseSudoku(SUDOKU_EXAMPLES[0].board);
  let errorCells = new Set();
  let focusIndex = -1;
  const status = h('div');

  const exampleSelect = select(SUDOKU_EXAMPLES.map((e) => ({ value: e.id, label: e.name })), 'easy');
  const seedInput = numberInput(1, { min: 0, max: 999999999 });
  const cluesInput = numberInput(30, { min: 17, max: 80 });
  const orderSelect = select([{ value: 'mrv', label: 'MRV (menos candidatos)' }, { value: 'static', label: 'Orden fijo (fila a fila)' }], 'mrv', () => prepare());
  const modeSelect = select([{ value: 'first', label: 'Primera solución' }, { value: 'all', label: 'Contar soluciones (hasta el límite)' }], 'first', () => prepare());
  const limitInput = numberInput(10, { min: 2, max: 10000, onchange: () => prepare() });
  const textArea = h('textarea', { rows: 3, 'aria-label': 'Tablero en texto (81 caracteres, 0 o . = vacío)' });

  params.append(
    paramGroup('Tablero',
      field('Ejemplo', exampleSelect),
      h('button', { type: 'button', class: 'btn small', onclick: () => guard(messages, () => { board = parseSudoku(SUDOKU_EXAMPLES.find((e) => e.id === exampleSelect.value).board); afterEdit(); }) }, 'Cargar ejemplo'),
      h('div', { class: 'inline-fields' }, field('Semilla', seedInput), field('Pistas objetivo', cluesInput)),
      h('button', { type: 'button', class: 'btn small', onclick: () => guard(messages, generate) }, 'Generar Sudoku (único)'),
      field('Texto (81 caracteres)', textArea),
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => guard(messages, () => { board = parseSudoku(textArea.value); afterEdit(); }) }, 'Cargar texto'),
        h('button', { type: 'button', class: 'btn small', onclick: () => { board = new Array(81).fill(0); afterEdit(); } }, 'Vaciar'))),
    paramGroup('Comprobaciones',
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => guard(messages, validate) }, 'Validar reglas'),
        h('button', { type: 'button', class: 'btn small', onclick: () => guard(messages, checkUniqueness) }, 'Comprobar unicidad'))),
    paramGroup('Resolución',
      field('Selección de variable', orderSelect),
      field('Modo', modeSelect),
      field('Límite de soluciones (modo contar)', limitInput),
      h('p', { class: 'hint' }, 'Edita las pistas en el tablero mientras la ejecución está en el paso 0.')),
  );

  const grid = h('div', { class: 'sudoku', role: 'grid', 'aria-label': 'Tablero de Sudoku' });
  const resultBox = h('div');
  visual.append(h('div', { class: 'board-wrap' }, grid),
    legend([{ className: 'sw-given', label: 'Pista' }, { className: 'sw-assigned', label: 'Asignada por la búsqueda' }, { className: 'sw-trying', label: 'Celda actual / candidato' }, { className: 'sw-conflict', label: 'Conflicto' }]),
    status, resultBox);
  extra.append(h('h3', {}, 'Sudoku como búsqueda'), h('p', { class: 'muted' }, 'Variables: celdas vacías. Valores: 1–9. Restricción: ningún valor se repite en la fila, columna o caja de 3×3. El motor mantiene máscaras de bits por fila, columna y caja para comprobar cada candidato en tiempo constante.'));

  function afterEdit() {
    errorCells = new Set();
    showMessage(messages, null);
    clear(status);
    prepare();
  }

  function generate() {
    const seed = readInt(seedInput, 'La semilla', 0, 999999999);
    const target = readInt(cluesInput, 'Las pistas objetivo', 17, 80);
    const t0 = now();
    const g = generateSudoku(seed, { targetClues: target });
    board = g.puzzle;
    afterEdit();
    showMessage(status, `Generado con ${g.clues} pistas en ${formatMs(now() - t0)}. Unicidad verificada: cada retirada de pista se comprobó contando soluciones (se acepta solo si hay exactamente 1); se hicieron ${g.uniquenessChecks} comprobaciones.${g.clues > target ? ' No se pudieron quitar más pistas sin perder la unicidad.' : ''}`, 'ok');
  }

  function validate() {
    const v = validateSudoku(board);
    errorCells = new Set(v.errors.flatMap((e) => [e.index, e.other]).filter((x) => x !== undefined));
    render(panel.controller?.state, panel.controller);
    if (v.valid) showMessage(status, 'Las pistas cumplen las reglas (no hay repeticiones). Esto no garantiza que exista solución.', 'ok');
    else showMessage(status, `Tablero inválido: ${v.errors.map((e) => e.message).join(' ')}`, 'error');
  }

  function checkUniqueness() {
    const v = validateSudoku(board);
    if (!v.valid) { validate(); return; }
    const t0 = now();
    const r = countSolutions(board, 2);
    const elapsed = formatMs(now() - t0);
    if (r.count === 0) showMessage(status, `Sin solución: la búsqueda exhaustiva no encontró ninguna (${elapsed}).`, 'warn');
    else if (r.count === 1) showMessage(status, `Solución única verificada: la búsqueda exhaustiva encontró exactamente una (${elapsed}).`, 'ok');
    else showMessage(status, `Soluciones múltiples: se encontraron al menos 2 (la búsqueda se detuvo en 2) (${elapsed}).`, 'warn');
  }

  function prepare() {
    textArea.value = formatSudoku(board);
    const v = validateSudoku(board);
    if (!v.valid) {
      panel.unload();
      errorCells = new Set(v.errors.flatMap((e) => [e.index, e.other]).filter((x) => x !== undefined));
      showMessage(status, `Tablero inválido, no se puede resolver: ${v.errors[0].message}`, 'error');
      render(null, null);
      return;
    }
    const snapshot = board.slice();
    const mode = modeSelect.value;
    let maxSolutions = 1;
    if (mode === 'all') {
      try {
        maxSolutions = readInt(limitInput, 'El límite de soluciones', 2, 10000);
      } catch (error) {
        showMessage(messages, error.message, 'error');
        return;
      }
    }
    panel.load({
      createRun: () => solveSudoku(snapshot, { variableOrder: orderSelect.value, mode, maxSolutions }),
      model: backtrackingModel(),
      maxEvents: 300000,
    });
  }

  function render(state, controller) {
    const editing = !controller || controller.position === 0;
    clear(grid);
    const conflictPeers = new Set(state?.conflict?.with ?? []);
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      const classes = ['sudoku-cell'];
      if (c % 3 === 2 && c < 8) classes.push('box-r');
      if (r % 3 === 2 && r < 8) classes.push('box-b');
      if (board[i]) classes.push('given');
      if (errorCells.has(i)) classes.push('error');
      let content = '';
      if (editing) {
        const input = h('input', { inputmode: 'numeric', maxlength: 1, value: board[i] ? String(board[i]) : '', 'aria-label': `Celda ${cellName(i)}` });
        input.addEventListener('change', () => {
          focusIndex = i;
          const value = input.value.trim();
          if (value === '' || value === '0' || value === '.') board[i] = 0;
          else if (/^[1-9]$/.test(value)) board[i] = Number(value);
          else {
            input.value = board[i] ? String(board[i]) : '';
            showMessage(status, 'Introduce un dígito del 1 al 9 (o deja la celda vacía).', 'error');
            return;
          }
          afterEdit();
        });
        content = input;
      } else if (board[i]) {
        content = String(board[i]);
      } else if (state?.assignment.has(i)) {
        classes.push('assigned');
        content = String(state.assignment.get(i));
      }
      if (state && !editing) {
        if (state.current === i) classes.push('current');
        if (state.trying?.variable === i) {
          classes.push('trying');
          if (!state.assignment.has(i)) content = String(state.trying.value);
        }
        if (state.conflict?.variable === i) classes.push('conflict');
        if (conflictPeers.has(i)) classes.push('peer-conflict');
      }
      grid.append(h('div', { class: classes.join(' '), role: 'gridcell' }, content));
    }
    // Mantener el foco al reconstruir el tablero tras editar una celda.
    if (editing && focusIndex >= 0) {
      grid.children[focusIndex]?.querySelector('input')?.focus();
      focusIndex = -1;
    }
    clear(resultBox);
    const result = controller?.result;
    if (controller?.isComplete && result) {
      const count = result.solutionCount;
      let text;
      if (count === 0) text = 'La búsqueda exhaustiva no encontró ninguna solución: el Sudoku no tiene solución.';
      else if (modeSelect.value === 'first') text = 'Solución encontrada. (Para saber si es única, usa «Comprobar unicidad» o el modo contar.)';
      else if (result.complete) text = `Búsqueda exhaustiva: ${count} solución(es)${count === 1 ? ' — solución única verificada' : ' — el Sudoku tiene soluciones múltiples'}.`;
      else text = `Se alcanzó el límite: al menos ${count} soluciones (no se exploró todo el espacio).`;
      resultBox.append(h('div', { class: `notice ${count === 1 || (count > 0 && modeSelect.value === 'first') ? 'notice-ok' : 'notice-warn'}` }, text));
    }
  }

  return { prepare, render };
}

// =================================================================== N reinas

function queensView({ params, visual, extra, panel, messages }) {
  const nInput = numberInput(8, { min: 1, max: MAX_QUEENS, onchange: () => prepare() });
  const modeSelect = select([{ value: 'first', label: 'Primera solución' }, { value: 'all', label: 'Todas las soluciones' }], 'first', () => prepare());
  const orderSelect = select([{ value: 'static', label: 'Fila a fila' }, { value: 'mrv', label: 'MRV' }], 'static', () => prepare());
  params.append(paramGroup('N reinas',
    field('Tamaño n', nInput, `Entre 1 y ${MAX_QUEENS}. Con «todas», n > 12 puede tardar mucho; se puede detener.`),
    field('Modo', modeSelect),
    field('Selección de variable', orderSelect)));
  const board = h('div', { class: 'chess', role: 'grid', 'aria-label': 'Tablero de ajedrez' });
  const info = h('div');
  visual.append(h('div', { class: 'board-wrap' }, board),
    legend([{ className: 'sw-trying', label: 'Candidato en prueba' }, { className: 'sw-conflict', label: 'Conflicto' }]),
    info);
  extra.append(h('h3', {}, 'Modelo'), h('p', { class: 'muted' }, 'Variable = fila; valor = columna de la reina. Restricciones: dos reinas no comparten columna ni diagonal (|c₁ − c₂| ≠ |f₁ − f₂|). Recuentos conocidos (OEIS A000170): ' + KNOWN_SOLUTION_COUNTS.map((c, i) => `n=${i}: ${c}`).slice(1).join(', ') + '.'));
  let n = 8;

  function prepare() {
    try {
      n = readInt(nInput, 'El tamaño n', 1, MAX_QUEENS);
    } catch (error) {
      showMessage(messages, error.message, 'error');
      return;
    }
    showMessage(messages, null);
    const mode = modeSelect.value;
    const order = orderSelect.value;
    panel.load({ createRun: () => solveNQueens(n, { mode, variableOrder: order }), model: backtrackingModel(), maxEvents: 300000 });
  }

  function render(state, controller) {
    const size = Math.max(18, Math.min(52, Math.floor(480 / n)));
    board.style.setProperty('--sq', `${size}px`);
    board.style.gridTemplateColumns = `repeat(${n}, ${size}px)`;
    clear(board);
    const attackers = new Set(state?.conflict?.with ?? []);
    const display = state && controller?.isComplete && state.assignment.size === 0 && state.lastSolution
      ? new Map(Object.entries(state.lastSolution).map(([k, v]) => [Number(k), v]))
      : state?.assignment ?? new Map();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const classes = ['chess-cell', (r + c) % 2 ? 'dark' : 'light'];
        let content = '';
        if (display.get(r) === c) {
          content = '♛';
          if (attackers.has(r)) classes.push('attacker');
        }
        if (state?.current === r) classes.push('row-current');
        if (state?.trying?.variable === r && state.trying.value === c) {
          classes.push('trying');
          content = '♛';
        }
        if (state?.conflict?.variable === r && state.conflict.value === c) classes.push('conflict');
        board.append(h('div', { class: classes.join(' '), role: 'gridcell', 'aria-label': `fila ${r + 1}, columna ${c + 1}${content ? ', reina' : ''}` }, content));
      }
    }
    clear(info);
    if (controller?.isComplete && controller.result) {
      const res = controller.result;
      const known = KNOWN_SOLUTION_COUNTS[n];
      if (res.solutionCount === 0) info.append(h('div', { class: 'notice notice-warn' }, `Búsqueda exhaustiva: no existe ninguna solución para n = ${n}.`));
      else if (modeSelect.value === 'all') {
        info.append(h('div', { class: 'notice notice-ok' }, `${res.solutionCount} soluciones encontradas (búsqueda exhaustiva).${known !== undefined ? ` Valor conocido: ${known} — ${known === res.solutionCount ? 'coincide' : 'NO coincide'}.` : ''} Se muestra la última.`));
      } else info.append(h('div', { class: 'notice notice-ok' }, `Primera solución encontrada tras ${formatNumber(res.metrics.nodes)} asignaciones.`));
    }
  }
  return { prepare, render };
}

// =================================================================== Tareas

function tasksView({ params, visual, extra, panel, messages }) {
  let instance = DEFAULT_INSTANCE;
  const strategySelect = select(Object.values(TASK_STRATEGIES).map((s) => ({ value: s.id, label: s.name })), 'improved', () => prepare());
  const seedInput = numberInput(1, { min: 0, max: 999999999 });
  const agentsInput = numberInput(4, { min: 2, max: 8 });
  const tasksInput = numberInput(7, { min: 2, max: 10 });
  const compareBox = h('div');
  params.append(
    paramGroup('Estrategia', field('Estrategia', strategySelect),
      h('button', { type: 'button', class: 'btn', onclick: () => guard(messages, compare) }, 'Comparar estrategias')),
    paramGroup('Instancia',
      h('button', { type: 'button', class: 'btn small', onclick: () => { instance = DEFAULT_INSTANCE; prepare(); } }, 'Instancia de ejemplo'),
      h('div', { class: 'inline-fields' }, field('Agentes', agentsInput), field('Tareas', tasksInput)),
      field('Semilla', seedInput),
      h('button', { type: 'button', class: 'btn small', onclick: () => guard(messages, () => {
        instance = randomInstance(readInt(seedInput, 'La semilla', 0, 999999999), { agents: readInt(agentsInput, 'Los agentes', 2, 8), tasks: readInt(tasksInput, 'Las tareas', 2, 10) });
        prepare();
      }) }, 'Instancia aleatoria')),
  );
  const tableHolder = h('div');
  const info = h('div');
  visual.append(tableHolder, legend([{ className: 'sw-assigned', label: 'Asignada' }, { className: 'sw-trying', label: 'Probando' }, { className: 'sw-conflict', label: 'Conflicto' }, { className: 'sw-chosen', label: 'Mejor solución hasta ahora' }]), info);
  extra.append(h('h3', {}, 'Comparación de estrategias'), compareBox);

  function prepare() {
    showMessage(messages, null);
    const inst = instance;
    const strategy = strategySelect.value;
    panel.load({ createRun: () => solveTaskAssignment(inst, { strategy }), model: backtrackingModel(), maxEvents: 300000 });
    clear(compareBox).append(h('p', { class: 'muted' }, 'Pulsa «Comparar estrategias» para resolver con ambas y comparar el esfuerzo.'));
  }

  function render(state, controller) {
    const agents = instance.agents;
    const best = state?.best ?? null;
    const rows = instance.tasks.map((t) => h('tr', {},
      h('th', { scope: 'row' }, `${t.name} `, h('small', { class: 'muted' }, `(${t.skill})`)),
      agents.map((a) => {
        const classes = [];
        if (!a.skills.includes(t.skill)) classes.push('na');
        if (state?.assignment.get(t.id) === a.id) classes.push('ok');
        if (state?.trying?.variable === t.id && state.trying.value === a.id) classes.push('trying');
        if (state?.conflict?.variable === t.id && state.conflict.value === a.id) classes.push('conflict');
        if (best && best[t.id] === a.id) classes.push('best');
        return h('td', { class: classes.join(' ') }, String(instance.cost[t.id][a.id]));
      })));
    clear(tableHolder).append(
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table assign-table' },
        h('caption', {}, 'Coste de cada tarea (filas) con cada agente (columnas); en gris, agentes sin la habilidad'),
        h('thead', {}, h('tr', {}, h('th', {}, 'Tarea'), agents.map((a) => h('th', { scope: 'col' }, `${a.name}`, h('br'), h('small', { class: 'muted' }, `${a.skills.join(', ')} · cap. ${a.capacity}`))))),
        h('tbody', {}, rows))),
      h('p', { class: 'hint' }, `Incompatibles (no pueden ir al mismo agente): ${(instance.incompatible ?? []).map(([x, y]) => `${instance.tasks.find((t) => t.id === x).name} – ${instance.tasks.find((t) => t.id === y).name}`).join('; ') || 'ninguna'}.`));
    clear(info);
    if (state?.bestCost !== null && state?.bestCost !== undefined) info.append(h('p', {}, `Mejor coste encontrado hasta este paso: `, h('strong', {}, String(state.bestCost))));
    if (controller?.isComplete && controller.result) {
      const r = controller.result;
      if (!r.best) info.append(h('div', { class: 'notice notice-warn' }, 'No existe ninguna asignación que cumpla todas las restricciones.'));
      else info.append(h('div', { class: 'notice notice-ok' }, `Coste óptimo: ${r.bestCost} (búsqueda exhaustiva${r.metrics.boundPrunes ? ' con poda por cota, que es segura' : ''}). Asignación válida: ${isValidAssignment(instance, r.best) ? 'sí' : 'NO'}.`));
    }
  }

  function compare() {
    const rows = Object.values(TASK_STRATEGIES).map((s) => {
      const t0 = now();
      const { result } = runToCompletion(solveTaskAssignment(instance, { strategy: s.id, trace: false }));
      const time = now() - t0;
      return { name: s.name, cost: result.bestCost, nodes: result.metrics.nodes, checks: result.metrics.checks, backtracks: result.metrics.backtracks, prunes: result.metrics.boundPrunes, solutions: result.metrics.solutions, time };
    });
    const same = rows[0].cost === rows[1].cost;
    clear(compareBox).append(
      table([
        { key: 'name', label: 'Estrategia' },
        { key: 'cost', label: 'Coste óptimo', format: (v) => (v === null ? 'sin solución' : String(v)) },
        { key: 'nodes', label: 'Asignaciones', format: (v) => formatNumber(v) },
        { key: 'checks', label: 'Comprobaciones', format: (v) => formatNumber(v) },
        { key: 'backtracks', label: 'Retrocesos', format: (v) => formatNumber(v) },
        { key: 'prunes', label: 'Podas por cota', format: (v) => formatNumber(v) },
        { key: 'solutions', label: 'Soluciones completas visitadas', format: (v) => formatNumber(v) },
        { key: 'time', label: 'Tiempo (1 ejecución)', format: (v) => formatMs(v) },
      ], rows),
      h('div', { class: `notice ${same ? 'notice-ok' : 'notice-error'}` }, same ? 'Ambas estrategias son exactas y obtienen el mismo coste óptimo.' : 'Las estrategias obtienen costes distintos: esto indicaría un error.'));
  }

  return { prepare, render };
}
