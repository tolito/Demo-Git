import { now, runToCompletion } from '../../core/trace.js';
import { MAX_SIZE, MIN_SIZE, MOVEMENT, cloneGrid, createGrid, minCellCost, toCoords } from '../../algorithms/pathfinding/grid.js';
import { HEURISTICS, defaultHeuristicFor, isAdmissible, makeHeuristicFn } from '../../algorithms/pathfinding/heuristics.js';
import { SCENARIOS, generateMaze, generateRandomObstacles } from '../../algorithms/pathfinding/maps.js';
import { PATHFINDING_ALGORITHMS } from '../../algorithms/pathfinding/search.js';
import { CELL, pathfindingModel } from '../../visualization/models.js';
import { cellFromPoint, drawGrid, layoutGrid, readPalette } from '../../visualization/grid-renderer.js';
import { formatMs, formatNumber } from '../../utils/format.js';
import { clear, field, frameThrottle, guard, h, numberInput, readFloat, readInt, select, showMessage, yieldToUI } from '../dom.js';
import { createLabLayout, legend, paramGroup, table } from '../components/lab-layout.js';
import { createRunPanel } from '../components/run-session.js';

const METRIC_LABELS = {
  expanded: 'Nodos expandidos',
  discovered: 'Nodos descubiertos',
  pushes: 'Inserciones en frontera',
  pops: 'Extracciones de frontera',
  edgeChecks: 'Aristas examinadas',
  relaxations: 'Relajaciones',
  staleSkips: 'Entradas obsoletas',
  frontierSize: 'Tamaño de frontera',
  frontierPeak: 'Pico de frontera',
  memoryPeak: 'Memoria estimada (entradas)',
};

const EVENT_LABELS = {
  init: 'inicio', discover: 'descubrir', repush: 'reapilar', update: 'mejorar g', expand: 'expandir',
  skip: 'descartar', goal: 'destino', path: 'camino', 'no-path': 'sin camino',
};

const TOOLS = [
  { id: 'wall', label: 'Pared' },
  { id: 'erase', label: 'Borrar (coste 1)' },
  { id: 'start', label: 'Origen' },
  { id: 'goal', label: 'Destino' },
  { id: 'cost3', label: 'Hierba (coste 3)' },
  { id: 'cost5', label: 'Barro (coste 5)' },
  { id: 'cost9', label: 'Agua (coste 9)' },
];

export const pathfindingLab = {
  id: 'pathfinding',
  title: 'Búsqueda de caminos',
  summary: 'BFS, DFS, Dijkstra y A* sobre una cuadrícula editable con obstáculos y costes de terreno.',
  mount(container) {
    const help = [
      h('p', {}, 'Dibuja obstáculos y terreno, elige origen y destino y ejecuta un algoritmo paso a paso. Cada paso corresponde a una operación real del algoritmo: descubrir una celda (añadirla a la frontera), mejorar su coste g, expandirla (sacarla de la frontera) o descartar una entrada obsoleta.'),
      h('p', {}, h('strong', {}, 'Reglas de movimiento: '), 'ortogonal (4 vecinos, paso 1) o diagonal (8 vecinos, paso diagonal √2). Con diagonales no se atraviesan esquinas: el paso diagonal exige que las dos celdas ortogonales adyacentes estén libres. El coste de un movimiento es el coste de la celda de destino multiplicado por la longitud del paso.'),
      h('p', {}, h('strong', {}, 'Garantías: '), 'BFS minimiza el número de movimientos (y el coste solo si todos los movimientos cuestan igual). DFS encuentra una ruta, sin garantía de optimalidad. Dijkstra es óptimo con costes no negativos. A* es óptimo con una heurística admisible y consistente; Manhattan no es admisible con diagonales.'),
      h('p', {}, 'Teclado: con el foco en el mapa, las flechas mueven el cursor y Espacio/Intro aplica la herramienta. Fuera de los campos de texto: Espacio inicia o pausa, ← y → retroceden y avanzan un paso.'),
    ];
    const layout = createLabLayout({ title: this.title, summary: this.summary, help });
    container.append(layout.root);

    let grid = SCENARIOS[1].build();
    let tool = 'wall';
    let cellSize = 20;
    let palette = readPalette(document.documentElement);
    let focusCell = -1;
    let hoverCell = -1;

    // ------------------------------------------------------- parámetros
    const algorithmSelect = select(Object.values(PATHFINDING_ALGORITHMS).map((a) => ({ value: a.id, label: a.name })), 'astar', () => { updateHeuristicVisibility(); resetRun(); });
    const movementSelect = select([
      { value: MOVEMENT.ORTHOGONAL, label: 'Ortogonal (4 vecinos)' },
      { value: MOVEMENT.DIAGONAL, label: 'Diagonal (8 vecinos, sin cortar esquinas)' },
    ], MOVEMENT.ORTHOGONAL, () => {
      heuristicSelect.value = defaultHeuristicFor(movementSelect.value);
      updateHeuristicVisibility();
      resetRun();
    });
    const heuristicSelect = select(Object.values(HEURISTICS).map((x) => ({ value: x.id, label: x.name })), 'manhattan', () => { updateHeuristicVisibility(); resetRun(); });
    const heuristicNote = h('small', { class: 'hint' });
    const heuristicField = field('Heurística (A*)', heuristicSelect);
    heuristicField.append(heuristicNote);
    const algoDescription = h('p', { class: 'algo-description' });

    const widthInput = numberInput(grid.width, { min: MIN_SIZE, max: MAX_SIZE });
    const heightInput = numberInput(grid.height, { min: MIN_SIZE, max: MAX_SIZE });
    const seedInput = numberInput(1, { min: 0, max: 999999999 });
    const densityInput = numberInput(0.28, { min: 0, max: 0.8, step: 0.02 });
    const scenarioSelect = select(SCENARIOS.map((s) => ({ value: s.id, label: s.name })), 'wall-gap');
    const scenarioNote = h('small', { class: 'hint' }, SCENARIOS[1].description);
    scenarioSelect.addEventListener('change', () => { scenarioNote.textContent = SCENARIOS.find((s) => s.id === scenarioSelect.value).description; });

    const toolButtons = TOOLS.map((t) => h('button', {
      type: 'button', class: `tool${t.id === tool ? ' active' : ''}`, 'aria-pressed': t.id === tool ? 'true' : 'false', dataset: { tool: t.id },
      onclick: () => setTool(t.id),
    }, t.label));

    function setTool(id) {
      tool = id;
      for (const b of toolButtons) {
        const active = b.dataset.tool === id;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }

    const compareButton = h('button', { type: 'button', class: 'btn', onclick: () => guard(layout.messages, compareAll) }, 'Comparar los 4 algoritmos');

    layout.params.append(
      paramGroup('Algoritmo',
        field('Algoritmo', algorithmSelect),
        algoDescription,
        field('Movimiento', movementSelect),
        heuristicField,
        h('p', { class: 'hint' }, 'La ejecución se prepara automáticamente con el mapa actual: usa los controles de reproducción.'),
        h('div', { class: 'button-row' }, compareButton)),
      paramGroup('Editor de mapa',
        h('div', { class: 'tool-grid', role: 'group', 'aria-label': 'Herramienta de edición' }, toolButtons),
        h('p', { class: 'hint' }, 'Haz clic o arrastra sobre el mapa para pintar.'),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', class: 'btn small', onclick: () => editGrid(() => { grid.walls.fill(0); grid.costs.fill(1); }) }, 'Limpiar mapa'),
          h('button', { type: 'button', class: 'btn small', onclick: () => resetRun() }, 'Limpiar búsqueda'))),
      paramGroup('Tamaño y generación',
        h('div', { class: 'inline-fields' }, field('Ancho', widthInput), field('Alto', heightInput)),
        h('button', { type: 'button', class: 'btn small', onclick: () => guard(layout.messages, applySize) }, 'Aplicar tamaño (vacía el mapa)'),
        h('div', { class: 'inline-fields' }, field('Semilla', seedInput), field('Densidad', densityInput)),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', class: 'btn small', onclick: () => guard(layout.messages, () => replaceGrid(generateMaze(readInt(widthInput, 'El ancho', 5, MAX_SIZE), readInt(heightInput, 'El alto', 5, MAX_SIZE), readInt(seedInput, 'La semilla', 0, 999999999)))) }, 'Laberinto'),
          h('button', { type: 'button', class: 'btn small', onclick: () => guard(layout.messages, () => replaceGrid(generateRandomObstacles(readInt(widthInput, 'El ancho', MIN_SIZE, MAX_SIZE), readInt(heightInput, 'El alto', MIN_SIZE, MAX_SIZE), readInt(seedInput, 'La semilla', 0, 999999999), { density: readFloat(densityInput, 'La densidad', 0, 0.8) }))) }, 'Obstáculos'),
          h('button', { type: 'button', class: 'btn small', onclick: () => guard(layout.messages, () => replaceGrid(generateRandomObstacles(readInt(widthInput, 'El ancho', MIN_SIZE, MAX_SIZE), readInt(heightInput, 'El alto', MIN_SIZE, MAX_SIZE), readInt(seedInput, 'La semilla', 0, 999999999), { density: readFloat(densityInput, 'La densidad', 0, 0.8), terrain: true }))) }, 'Obstáculos + terreno'))),
      paramGroup('Escenarios',
        field('Escenario', scenarioSelect),
        scenarioNote,
        h('button', { type: 'button', class: 'btn small', onclick: () => replaceGrid(SCENARIOS.find((s) => s.id === scenarioSelect.value).build()) }, 'Cargar escenario')),
    );

    // ------------------------------------------------------- vista
    const canvas = h('canvas', { class: 'grid-canvas', tabindex: '0', role: 'img', 'aria-label': 'Mapa de búsqueda. Usa las flechas para mover el cursor y Espacio para editar.' });
    const canvasWrap = h('div', { class: 'canvas-wrap' }, canvas);
    const cellInfo = h('p', { class: 'cell-info', 'aria-live': 'polite' }, 'Pasa el puntero por una celda para inspeccionarla.');
    const resultBox = h('div', { class: 'result-box' });
    layout.visual.append(
      canvasWrap,
      legend([
        { className: 'sw-empty', label: 'No explorada' },
        { className: 'sw-frontier', label: 'Frontera' },
        { className: 'sw-visited', label: 'Expandida' },
        { className: 'sw-current', label: 'Actual' },
        { className: 'sw-path', label: 'Camino final' },
        { className: 'sw-start', label: 'Origen (O)' },
        { className: 'sw-goal', label: 'Destino (D)' },
        { className: 'sw-wall', label: 'Obstáculo' },
        { className: 'sw-t3', label: 'Coste 3' },
        { className: 'sw-t5', label: 'Coste 5' },
        { className: 'sw-t9', label: 'Coste 9' },
      ]),
      cellInfo,
      resultBox);

    const panel = createRunPanel({
      metricLabels: METRIC_LABELS,
      eventTypeLabels: EVENT_LABELS,
      onRender: (state, controller) => {
        draw(state);
        renderResult(controller);
        updateCellInfo();
      },
    });
    layout.side.append(panel.controlsElement, panel.metricsElement);
    layout.below.append(panel.logElement);
    const compareBox = h('section', { class: 'panel compare wide' }, h('h3', {}, 'Comparador'), h('p', { class: 'muted' }, 'Pulsa «Comparar los 4 algoritmos» para ejecutar todos sobre el mismo mapa.'));
    layout.below.append(compareBox);

    // ------------------------------------------------------- ejecución
    let runGrid = null;

    function currentOptions() {
      const movement = movementSelect.value;
      return { movement, heuristic: heuristicSelect.value };
    }

    function prepareRun() {
      showMessage(layout.messages, null);
      runGrid = cloneGrid(grid);
      const algorithm = PATHFINDING_ALGORITHMS[algorithmSelect.value];
      const options = currentOptions();
      const size = runGrid.width * runGrid.height;
      panel.load({
        createRun: () => algorithm.run(runGrid, options),
        model: pathfindingModel(runGrid),
        maxEvents: 300000,
        checkpointInterval: Math.max(400, Math.ceil(size / 20)),
      });
    }

    /** Descarta la ejecución actual y prepara otra con el mapa y opciones actuales. */
    function resetRun() {
      panel.unload();
      clear(resultBox);
      guard(layout.messages, prepareRun);
      draw(panel.controller?.state ?? null);
    }
    const scheduleReset = frameThrottle(resetRun);

    function renderResult(controller) {
      clear(resultBox);
      const result = controller.result;
      if (!controller.isComplete || !result) return;
      const algo = PATHFINDING_ALGORITHMS[result.algorithm];
      if (!result.found) {
        resultBox.append(h('div', { class: 'notice notice-warn' }, `${algo.name}: no existe camino entre el origen y el destino.`));
        return;
      }
      resultBox.append(h('div', { class: 'notice notice-ok' },
        h('strong', {}, `${algo.name}: camino encontrado. `),
        `${formatNumber(result.moves)} movimientos, longitud geométrica ${formatNumber(result.geometricLength, 3)}, coste ${formatNumber(result.cost, 3)} (calculado sobre el camino). `,
        h('em', {}, result.optimality.note)));
    }

    function draw(state) {
      const available = Math.max(200, canvasWrap.clientWidth || 640);
      const layoutInfo = layoutGrid(grid, available - 4, Math.max(320, window.innerHeight * 0.7));
      cellSize = layoutInfo.cell;
      drawGrid(canvas, runGrid ?? grid, state, { cell: cellSize, palette, focus: focusCell });
    }

    function updateCellInfo() {
      const index = hoverCell >= 0 ? hoverCell : focusCell;
      if (index < 0) return;
      const g = runGrid ?? grid;
      const { x, y } = toCoords(g, index);
      const state = panel.controller?.state;
      const parts = [`Celda (${x},${y})`];
      if (g.walls[index]) parts.push('obstáculo');
      else parts.push(`coste ${g.costs[index]}`);
      if (index === g.start) parts.push('origen');
      if (index === g.goal) parts.push('destino');
      if (state) {
        const s = state.cells[index];
        parts.push(s === CELL.VISITED ? 'expandida' : s === CELL.FRONTIER ? 'en frontera' : 'sin explorar');
        if (!Number.isNaN(state.g[index])) parts.push(`g = ${formatNumber(state.g[index], 3)}`);
      }
      if (algorithmSelect.value === 'astar' && !g.walls[index]) {
        const hFn = makeHeuristicFn(g, heuristicSelect.value, g.goal, minCellCost(g));
        parts.push(`h = ${formatNumber(hFn(index), 3)}`);
      }
      cellInfo.textContent = parts.join(' · ');
    }

    function updateHeuristicVisibility() {
      const isAStar = algorithmSelect.value === 'astar';
      heuristicField.hidden = !isAStar;
      algoDescription.textContent = PATHFINDING_ALGORITHMS[algorithmSelect.value].description;
      const admissible = isAdmissible(heuristicSelect.value, movementSelect.value);
      heuristicNote.textContent = admissible
        ? 'Admisible y consistente con este movimiento: A* devuelve un camino de coste mínimo.'
        : 'NO admisible con movimiento diagonal: A* puede devolver un camino más caro que el óptimo.';
      heuristicNote.className = `hint ${admissible ? '' : 'warn'}`;
    }

    // ------------------------------------------------------- edición
    function editGrid(mutator) {
      mutator();
      resetRun();
    }

    function replaceGrid(newGrid) {
      grid = newGrid;
      widthInput.value = String(grid.width);
      heightInput.value = String(grid.height);
      focusCell = -1;
      resetRun();
    }

    function applySize() {
      const w = readInt(widthInput, 'El ancho', MIN_SIZE, MAX_SIZE);
      const hgt = readInt(heightInput, 'El alto', MIN_SIZE, MAX_SIZE);
      const g = createGrid(w, hgt);
      replaceGrid(g);
    }

    function applyTool(index) {
      if (index < 0) return false;
      switch (tool) {
        case 'wall':
          if (index === grid.start || index === grid.goal) return false;
          grid.walls[index] = 1;
          break;
        case 'erase':
          grid.walls[index] = 0;
          grid.costs[index] = 1;
          break;
        case 'start':
          if (index === grid.goal) return false;
          grid.walls[index] = 0;
          grid.start = index;
          break;
        case 'goal':
          if (index === grid.start) return false;
          grid.walls[index] = 0;
          grid.goal = index;
          break;
        default: {
          const cost = Number(tool.slice(4));
          grid.walls[index] = 0;
          grid.costs[index] = cost;
        }
      }
      return true;
    }

    const redraw = frameThrottle(() => draw(panel.controller?.state ?? null));
    let painting = false;
    let lastPainted = -1;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      painting = true;
      const index = cellFromPoint(grid, cellSize, e.offsetX, e.offsetY);
      lastPainted = index;
      if (applyTool(index)) { scheduleReset(); redraw(); }
    });
    canvas.addEventListener('pointermove', (e) => {
      const index = cellFromPoint(grid, cellSize, e.offsetX, e.offsetY);
      if (index !== hoverCell) {
        hoverCell = index;
        updateCellInfo();
      }
      if (!painting || index === lastPainted) return;
      lastPainted = index;
      // Origen y destino no se arrastran: solo las herramientas de pintura.
      if (tool === 'start' || tool === 'goal') return;
      if (applyTool(index)) { scheduleReset(); redraw(); }
    });
    const endPaint = () => { painting = false; lastPainted = -1; };
    canvas.addEventListener('pointerup', endPaint);
    canvas.addEventListener('pointercancel', endPaint);
    canvas.addEventListener('pointerleave', () => { hoverCell = -1; });
    canvas.addEventListener('keydown', (e) => {
      const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (moves[e.key]) {
        e.preventDefault();
        e.stopPropagation();
        if (focusCell < 0) focusCell = grid.start;
        const { x, y } = toCoords(grid, focusCell);
        const nx = Math.min(grid.width - 1, Math.max(0, x + moves[e.key][0]));
        const ny = Math.min(grid.height - 1, Math.max(0, y + moves[e.key][1]));
        focusCell = ny * grid.width + nx;
        updateCellInfo();
        redraw();
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (focusCell >= 0 && applyTool(focusCell)) { scheduleReset(); redraw(); }
      }
    });

    // ------------------------------------------------------- comparador
    let compareToken = 0;
    async function compareAll() {
      const token = ++compareToken;
      const snapshot = cloneGrid(grid);
      const options = currentOptions();
      clear(compareBox).append(h('h3', {}, 'Comparador'), h('p', { class: 'muted' }, 'Ejecutando…'));
      const rows = [];
      for (const algo of Object.values(PATHFINDING_ALGORITHMS)) {
        await yieldToUI();
        if (token !== compareToken || !compareBox.isConnected) return;
        // 1) Ejecución sin traza para obtener resultado y métricas.
        const { result } = runToCompletion(algo.run(snapshot, { ...options, trace: false }));
        // 2) Tiempo medido por separado: se repite la ejecución sin traza
        //    hasta acumular al menos 30 ms (máx. 200 repeticiones).
        let reps = 0;
        const t0 = now();
        while (reps < 200 && (reps < 3 || now() - t0 < 30)) {
          runToCompletion(algo.run(snapshot, { ...options, trace: false }));
          reps++;
        }
        const timeMs = (now() - t0) / reps;
        rows.push({
          name: algo.id === 'astar' ? `A* (${HEURISTICS[options.heuristic].name})` : algo.name,
          found: result.found,
          moves: result.found ? result.moves : null,
          geometricLength: result.found ? result.geometricLength : null,
          cost: result.found ? result.cost : null,
          expanded: result.metrics.expanded,
          discovered: result.metrics.discovered,
          operations: result.metrics.pushes + result.metrics.pops,
          edgeChecks: result.metrics.edgeChecks,
          memoryPeak: result.metrics.memoryPeak,
          timeMs,
          reps,
          guarantee: result.optimality.guaranteed ? 'Sí' : 'No',
          note: result.optimality.note,
        });
      }
      const bestCost = Math.min(...rows.filter((r) => r.found).map((r) => r.cost));
      for (const r of rows) if (r.found && Math.abs(r.cost - bestCost) < 1e-9) r.__class = 'best-row';
      clear(compareBox).append(
        h('h3', {}, 'Comparador (mismo mapa, mismo movimiento)'),
        table([
          { key: 'name', label: 'Algoritmo' },
          { key: 'found', label: '¿Solución?', format: (v) => (v ? 'Sí' : 'No') },
          { key: 'moves', label: 'Movimientos', format: (v) => formatNumber(v) },
          { key: 'geometricLength', label: 'Longitud geométrica', format: (v) => formatNumber(v, 3) },
          { key: 'cost', label: 'Coste total', format: (v) => formatNumber(v, 3) },
          { key: 'expanded', label: 'Expandidos', format: (v) => formatNumber(v) },
          { key: 'discovered', label: 'Descubiertos', format: (v) => formatNumber(v) },
          { key: 'operations', label: 'Operaciones frontera', title: 'Inserciones + extracciones', format: (v) => formatNumber(v) },
          { key: 'edgeChecks', label: 'Aristas examinadas', format: (v) => formatNumber(v) },
          { key: 'memoryPeak', label: 'Memoria estimada', title: 'Pico de entradas en frontera + tabla de predecesores', format: (v) => formatNumber(v) },
          { key: 'timeMs', label: 'Tiempo medio', format: (v, r) => `${formatMs(v)} (${r.reps} rep.)` },
          { key: 'guarantee', label: '¿Óptimo garantizado?', format: (v, r) => h('span', { title: r.note }, v) },
        ], rows),
        h('p', { class: 'hint' }, 'Movimientos = número de pasos; longitud geométrica = suma de longitudes de paso (1 o √2); coste = suma de costes de terreno × longitud. Los tiempos se miden aparte, sin generar eventos, repitiendo cada algoritmo sobre la misma carga; son orientativos y dependen del navegador. La memoria es una estimación en número de entradas, no en bytes. Las filas resaltadas tienen el coste mínimo de la tabla.'));
    }

    // ------------------------------------------------------- inicio
    const onResize = frameThrottle(() => draw(panel.controller?.state ?? null));
    window.addEventListener('resize', onResize);
    const themeObserver = new MutationObserver(() => {
      palette = readPalette(document.documentElement);
      draw(panel.controller?.state ?? null);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => { palette = readPalette(document.documentElement); draw(panel.controller?.state ?? null); };
    media?.addEventListener?.('change', onScheme);

    updateHeuristicVisibility();
    resetRun();
    requestAnimationFrame(() => draw(null));

    return () => {
      compareToken++;
      panel.dispose();
      redraw.cancel();
      scheduleReset.cancel();
      onResize.cancel();
      window.removeEventListener('resize', onResize);
      themeObserver.disconnect();
      media?.removeEventListener?.('change', onScheme);
    };
  },
};
