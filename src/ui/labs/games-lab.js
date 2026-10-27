import { now, runToCompletion } from '../../core/trace.js';
import { gameTreeSearch, moveValues } from '../../algorithms/game-theory/search.js';
import {
  TICTACTOE_POSITIONS, applyMove, createState, formatBoard, isTerminal, parseBoard, resultLabel, ticTacToe, winningLine,
} from '../../algorithms/game-theory/tictactoe.js';
import { TEXTBOOK_TREE, createSyntheticTree } from '../../algorithms/game-theory/synthetic-tree.js';
import { gameTreeModel } from '../../visualization/models.js';
import { renderTree } from '../../visualization/tree-renderer.js';
import { formatMs, formatNumber } from '../../utils/format.js';
import { checkbox, clear, field, guard, h, numberInput, readInt, select, showMessage } from '../dom.js';
import { createLabLayout, legend, paramGroup, table, tabs } from '../components/lab-layout.js';
import { createRunPanel } from '../components/run-session.js';

const METRIC_LABELS = {
  visited: 'Nodos visitados',
  leaves: 'Hojas evaluadas',
  terminalLeaves: 'Hojas terminales (exactas)',
  heuristicLeaves: 'Hojas heurísticas',
  cutoffs: 'Podas (cortes)',
  prunedBranches: 'Ramas podadas',
  maxDepth: 'Profundidad máxima',
};

const EVENT_LABELS = { enter: 'visitar', leaf: 'hoja', update: 'actualizar', prune: 'poda', exit: 'devolver', choose: 'elección' };

const ORDERINGS = {
  natural: 'Natural (orden de generación)',
  reverse: 'Inverso',
  random: 'Aleatorio (con semilla)',
  heuristic: 'Heurístico (ganar ya, centro, esquinas)',
  oracle: 'Oráculo (valores exactos; solo árbol sintético)',
};

export const gamesLab = {
  id: 'games',
  title: 'Teoría de juegos',
  navTitle: 'Juegos',
  summary: 'Minimax y poda alfa-beta con árbol de decisiones visible, sobre tres en raya y sobre árboles sintéticos configurables.',
  highlights: ['Valores minimax, α y β en cada nodo', 'Ramas podadas y jugada elegida', 'Comparación minimax vs. alfa-beta'],
  mount(container) {
    const help = [
      h('p', {}, 'MAX (triángulo hacia arriba) maximiza y MIN (triángulo hacia abajo) minimiza. Minimax explora todo el árbol (o hasta el límite de profundidad). Alfa-beta mantiene α (lo mejor que MAX ya tiene asegurado) y β (lo mejor para MIN); cuando α ≥ β, las jugadas restantes del nodo no pueden cambiar la decisión y se podan (✂).'),
      h('p', {}, 'Con alfa-beta, el valor de un nodo donde hubo poda es solo una cota (≥ v en MAX, ≤ v en MIN), pero el valor de la raíz es exactamente el valor minimax. Ambos algoritmos pueden elegir jugadas distintas si están empatadas en valor.'),
      h('p', {}, h('strong', {}, 'Tres en raya: '), 'X es MAX. Utilidad terminal exacta: +(100 − fichas) si gana X, −(100 − fichas) si gana O, 0 en empate (así se prefiere ganar antes). Si se corta por profundidad se usa una evaluación heurística (líneas abiertas: +1/+3 por 1/2 fichas propias, −1/−3 por las del rival), siempre |h| ≤ 24, y el valor se marca con *.'),
    ];
    const layout = createLabLayout({ title: this.title, summary: this.summary, help });
    container.append(layout.root);
    const tabBar = h('div');
    layout.root.insertBefore(tabBar, layout.messages);

    const panel = createRunPanel({ metricLabels: METRIC_LABELS, eventTypeLabels: EVENT_LABELS, onRender: (state, controller) => view?.render(state, controller) });
    layout.side.append(panel.controlsElement, panel.metricsElement);
    layout.below.append(panel.logElement);
    const compareBox = h('section', { class: 'panel' });
    layout.below.append(compareBox);

    let view = null;
    let mode = 'ttt';
    function show(id) {
      mode = id;
      clear(tabBar).append(tabs([{ id: 'ttt', label: 'Tres en raya' }, { id: 'tree', label: 'Árbol sintético' }], mode, show));
      panel.unload();
      clear(layout.params);
      clear(layout.visual);
      clear(compareBox).append(h('h3', {}, 'Minimax vs. alfa-beta'), h('p', { class: 'muted' }, 'Pulsa «Comparar» para resolver el mismo estado con ambos algoritmos.'));
      showMessage(layout.messages, null);
      view = (id === 'ttt' ? tttView : treeView)({ layout, panel, compareBox });
      view.prepare();
    }
    show(mode);
    return () => panel.dispose();
  },
};

/** Controles comunes: algoritmo, profundidad, orden. */
function searchControls(onChange, orderings) {
  const algorithm = select([{ value: 'alphabeta', label: 'Alfa-beta' }, { value: 'minimax', label: 'Minimax (sin poda)' }], 'alphabeta', onChange);
  const depth = numberInput(0, { min: 0, max: 9, onchange: onChange });
  const ordering = select(orderings.map((o) => ({ value: o, label: ORDERINGS[o] })), 'natural', onChange);
  const seed = numberInput(1, { min: 0, max: 999999999, onchange: onChange });
  const bounds = checkbox('Mostrar α y β en los nodos', true, onChange);
  const read = () => {
    const d = readInt(depth, 'La profundidad', 0, 9);
    return { alphaBeta: algorithm.value === 'alphabeta', depthLimit: d === 0 ? Infinity : d, ordering: ordering.value, seed: readInt(seed, 'La semilla', 0, 999999999) };
  };
  const group = paramGroup('Búsqueda',
    field('Algoritmo', algorithm),
    field('Límite de profundidad', depth, '0 = sin límite (hasta estados terminales).'),
    field('Orden de jugadas', ordering),
    field('Semilla (orden aleatorio)', seed),
    bounds);
  return { group, read, showBounds: () => bounds.querySelector('input').checked };
}

function treeArea(layout) {
  const wrap = h('div', { class: 'tree-wrap' });
  const info = h('div');
  layout.visual.append(h('h3', {}, 'Árbol de búsqueda'), wrap,
    legend([{ className: 'sw-assigned', label: 'MAX (▲) / MIN (▼)' }, { className: 'sw-trying', label: 'Nodo actual' }, { className: 'sw-pruned', label: 'Rama podada (✂)' }, { className: 'sw-chosen', label: 'Jugada elegida' }]),
    h('p', { class: 'hint' }, 'Valores: «≥v»/«≤v» son cotas tras una poda; «*» indica que el valor incluye evaluaciones heurísticas. Pasa el puntero por un nodo para ver sus detalles.'),
    info);
  return { wrap, info };
}

function compareSearch(game, state, depthLimit, ordering, seed, compareBox, describeMove) {
  const rows = [];
  const results = {};
  for (const alphaBeta of [false, true]) {
    const t0 = now();
    const { result } = runToCompletion(gameTreeSearch(game, state, { alphaBeta, depthLimit, ordering, seed, trace: false }));
    results[alphaBeta ? 'ab' : 'mm'] = result;
    rows.push({ name: alphaBeta ? 'Alfa-beta' : 'Minimax', value: result.value, exact: result.exact ? 'exacto' : 'heurístico', move: describeMove(result.bestMove), visited: result.metrics.visited, leaves: result.metrics.leaves, pruned: result.metrics.prunedBranches, cutoffs: result.metrics.cutoffs, time: now() - t0 });
  }
  const values = moveValues(game, state, { depthLimit });
  const abMoveValue = values.find((v) => v.move === results.ab.bestMove)?.value;
  const sameValue = results.mm.value === results.ab.value;
  const optimal = abMoveValue === results.mm.value;
  clear(compareBox).append(
    h('h3', {}, 'Minimax vs. alfa-beta (mismo estado y parámetros)'),
    table([
      { key: 'name', label: 'Algoritmo' },
      { key: 'value', label: 'Valor raíz' },
      { key: 'exact', label: 'Tipo de valor' },
      { key: 'move', label: 'Jugada elegida' },
      { key: 'visited', label: 'Nodos visitados', format: (v) => formatNumber(v) },
      { key: 'leaves', label: 'Hojas', format: (v) => formatNumber(v) },
      { key: 'pruned', label: 'Ramas podadas', format: (v) => formatNumber(v) },
      { key: 'time', label: 'Tiempo (1 ejec.)', format: (v) => formatMs(v) },
    ], rows),
    h('div', { class: `notice ${sameValue && optimal ? 'notice-ok' : 'notice-error'}` },
      `Mismo valor minimax: ${sameValue ? 'sí' : 'NO'}. La jugada de alfa-beta tiene valor minimax ${abMoveValue} y el óptimo es ${results.mm.value}: ${optimal ? 'jugada óptima equivalente' : 'NO es óptima (error)'}.`),
    h('p', { class: 'hint' }, `Valor minimax de cada jugada: ${values.map((v) => `${describeMove(v.move)} → ${v.value}`).join('; ')}.`));
}

// =================================================================== Tres en raya

function tttView({ layout, panel, compareBox }) {
  let state = parseBoard(TICTACTOE_POSITIONS.find((p) => p.id === 'must-block').board);
  const history = [];
  const presetSelect = select(TICTACTOE_POSITIONS.map((p) => ({ value: p.id, label: p.name })), 'must-block');
  const controls = searchControls(() => prepare(), ['natural', 'reverse', 'random', 'heuristic']);
  layout.params.append(
    paramGroup('Posición',
      field('Posición de ejemplo', presetSelect),
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => guard(layout.messages, () => setState(parseBoard(TICTACTOE_POSITIONS.find((p) => p.id === presetSelect.value).board), true)) }, 'Cargar'),
        h('button', { type: 'button', class: 'btn small', onclick: () => setState(createState(), true) }, 'Nueva partida'),
        h('button', { type: 'button', class: 'btn small', onclick: undo }, 'Deshacer')),
      h('p', { class: 'hint' }, 'Haz clic en una casilla libre para jugar con el turno actual.')),
    controls.group,
    paramGroup('Acciones',
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => guard(layout.messages, aiMove) }, 'La IA juega'),
        h('button', { type: 'button', class: 'btn', onclick: () => guard(layout.messages, () => compareSearch(ticTacToe, state, controls.read().depthLimit, controls.read().ordering, controls.read().seed, compareBox, (m) => `casilla ${m}`)) }, 'Comparar'))),
  );
  const boardEl = h('div', { class: 'ttt', role: 'grid', 'aria-label': 'Tablero de tres en raya' });
  const status = h('p', { 'aria-live': 'polite' });
  layout.visual.append(h('div', { class: 'split' }, h('div', {}, h('div', { class: 'board-wrap' }, boardEl), status)));
  const tree = treeArea(layout);

  function setState(next, clearHistory = false) {
    if (clearHistory) history.length = 0;
    state = next;
    prepare();
  }

  function undo() {
    if (history.length) setState(history.pop());
  }

  function play(move) {
    history.push(state);
    state = applyMove(state, move);
    prepare();
  }

  function aiMove() {
    if (isTerminal(state)) throw new Error('La partida ha terminado.');
    const options = controls.read();
    const { result } = runToCompletion(gameTreeSearch(ticTacToe, state, { ...options, trace: false }));
    play(result.bestMove);
  }

  function prepare() {
    showMessage(layout.messages, null);
    if (isTerminal(state)) {
      panel.unload();
      render(null, null);
      return;
    }
    let options;
    try {
      options = controls.read();
    } catch (error) {
      showMessage(layout.messages, error.message, 'error');
      return;
    }
    const root = state;
    const empty = root.board.filter((c) => c === null).length;
    if (empty >= 8 && options.depthLimit === Infinity) {
      showMessage(layout.messages, `Esta posición tiene un árbol muy grande (el tablero vacío tiene 549 946 nodos sin poda). La vista del árbol muestra los primeros 1500 nodos y el registro guarda como máximo 200 000 eventos; considera limitar la profundidad.`, 'warn');
    }
    panel.load({ createRun: () => gameTreeSearch(ticTacToe, root, options), model: gameTreeModel({ maxNodes: 1500 }), maxEvents: 200000, checkpointInterval: 300 });
  }

  function render(treeState, controller) {
    const line = winningLine(state);
    const suggestion = controller?.isComplete ? controller.result?.bestMove : null;
    clear(boardEl);
    state.board.forEach((c, i) => {
      const b = h('button', {
        type: 'button',
        class: `${c ? c.toLowerCase() : ''}${line?.includes(i) ? ' win' : ''}${suggestion === i ? ' suggest' : ''}`,
        disabled: c !== null || isTerminal(state),
        'aria-label': `Casilla ${i}${c ? `, ${c}` : ', libre'}`,
        onclick: () => play(i),
      }, c ?? '');
      boardEl.append(b);
    });
    status.textContent = `${resultLabel(state)}. Tablero: ${formatBoard(state.board)}.`;
    clear(tree.wrap).append(renderTree(treeState, { showBounds: controls.showBounds() }));
    clear(tree.info);
    if (treeState?.hidden) tree.info.append(h('div', { class: 'notice notice-warn' }, `Vista limitada: ${formatNumber(treeState.hidden)} nodos visitados no se dibujan (solo se muestran los primeros 1500). Las métricas sí los cuentan.`));
    if (controller?.isComplete && controller.result) {
      const r = controller.result;
      tree.info.append(h('div', { class: 'notice notice-ok' }, `Jugada elegida: casilla ${r.bestMove} (resaltada en el tablero), valor ${r.value} ${r.exact ? '(exacto: ' + (r.value > 0 ? 'gana X' : r.value < 0 ? 'gana O' : 'empate') + ' con juego perfecto)' : '(estimado: la búsqueda se cortó por profundidad)'}. Nodos visitados: ${formatNumber(r.metrics.visited)}.`));
    }
  }
  return { prepare, render };
}

// =================================================================== Árbol sintético

function treeView({ layout, panel, compareBox }) {
  const bInput = numberInput(3, { min: 2, max: 5 });
  const dInput = numberInput(3, { min: 1, max: 7 });
  const seedInput = numberInput(4, { min: 0, max: 999999999 });
  const leavesInput = h('textarea', { rows: 3, placeholder: 'Opcional: valores de hoja separados por comas (b^d valores)' });
  const controls = searchControls(() => prepare(), ['natural', 'reverse', 'random', 'oracle']);
  layout.params.append(
    paramGroup('Árbol',
      h('div', { class: 'inline-fields' }, field('Ramificación b', bInput), field('Profundidad d', dInput)),
      field('Semilla de las hojas', seedInput),
      field('Hojas personalizadas', leavesInput),
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => prepare() }, 'Aplicar'),
        h('button', { type: 'button', class: 'btn small', onclick: () => { bInput.value = '3'; dInput.value = '2'; leavesInput.value = TEXTBOOK_TREE.leaves.join(', '); prepare(); } }, 'Ejemplo de libro'))),
    controls.group,
    paramGroup('Acciones', h('button', { type: 'button', class: 'btn', onclick: () => guard(layout.messages, () => {
      const game = buildGame();
      const o = controls.read();
      compareSearch(game, game.initialState, o.depthLimit, o.ordering, o.seed, compareBox, (m) => game.moveLabel(m));
    }) }, 'Comparar')),
  );
  const tree = treeArea(layout);
  const leavesInfo = h('p', { class: 'hint' });
  layout.visual.append(leavesInfo);
  let game = null;

  function buildGame() {
    const branching = readInt(bInput, 'La ramificación', 2, 5);
    const depth = readInt(dInput, 'La profundidad', 1, 7);
    const text = leavesInput.value.trim();
    let leaves = null;
    if (text) {
      leaves = text.split(/[\s,;]+/).filter(Boolean).map(Number);
      if (leaves.some((v) => !Number.isFinite(v))) throw new Error('Las hojas deben ser números separados por comas.');
    }
    return createSyntheticTree({ branching, depth, seed: readInt(seedInput, 'La semilla', 0, 999999999), leaves });
  }

  function prepare() {
    showMessage(layout.messages, null);
    try {
      game = buildGame();
      const options = controls.read();
      const g = game;
      leavesInfo.textContent = `Hojas (de izquierda a derecha): ${g.leaves.join(', ')}. Mejor caso teórico de alfa-beta ≈ b^⌈d/2⌉ + b^⌊d/2⌋ − 1 = ${g.branching ** Math.ceil(g.depth / 2) + g.branching ** Math.floor(g.depth / 2) - 1} hojas, frente a ${g.leaves.length} de minimax.`;
      panel.load({ createRun: () => gameTreeSearch(g, g.initialState, options), model: gameTreeModel({ maxNodes: 1500 }), maxEvents: 200000 });
    } catch (error) {
      panel.unload();
      showMessage(layout.messages, error.message, 'error');
    }
  }

  function render(treeState, controller) {
    clear(tree.wrap).append(renderTree(treeState, { showBounds: controls.showBounds() }));
    clear(tree.info);
    if (treeState?.hidden) tree.info.append(h('div', { class: 'notice notice-warn' }, `Vista limitada: ${formatNumber(treeState.hidden)} nodos no se dibujan.`));
    if (controller?.isComplete && controller.result) {
      const r = controller.result;
      tree.info.append(h('div', { class: 'notice notice-ok' }, `Valor de la raíz: ${r.value}. Jugada elegida: ${game.moveLabel(r.bestMove)}. Hojas evaluadas: ${r.metrics.leaves} de ${game.leaves.length}.`));
    }
  }
  return { prepare, render };
}
