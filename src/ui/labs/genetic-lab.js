import { now } from '../../core/trace.js';
import { DEFAULT_CONFIG, SELECTION_METHODS, geneticAlgorithm } from '../../algorithms/genetic/engine.js';
import { DEFAULT_KNAPSACK, functionProblem, knapsackProblem, randomCities, randomKnapsack, tspProblem } from '../../algorithms/genetic/problems.js';
import { geneticModel } from '../../visualization/models.js';
import { lineChart, scatterChart } from '../../visualization/charts.js';
import { formatMs, formatNumber } from '../../utils/format.js';
import { checkbox, clear, field, h, numberInput, readFloat, readInt, select, showMessage, svg } from '../dom.js';
import { createLabLayout, paramGroup } from '../components/lab-layout.js';
import { createRunPanel } from '../components/run-session.js';

const METRIC_LABELS = {
  generation: 'Generación',
  bestFitness: 'Mejor aptitud (histórica)',
  meanFitness: 'Aptitud media',
  diversity: 'Diversidad',
  evaluations: 'Evaluaciones',
  crossovers: 'Cruces',
  mutations: 'Individuos mutados',
};

const EVENT_LABELS = { generation: 'generación', crossover: 'cruce', mutation: 'mutación', stop: 'parada' };

export const geneticLab = {
  id: 'genetic',
  title: 'Algoritmos genéticos',
  navTitle: 'Genéticos',
  summary: 'Motor genético reproducible con semilla: función multimodal, mochila 0/1 y viajante, comparados con la solución exacta.',
  highlights: ['Mejor, media y peor por generación', 'Diversidad de la población', 'Comparación con el óptimo exacto'],
  mount(container) {
    const help = [
      h('p', {}, 'Cada generación: se evalúa la población, se copian los mejores (elitismo), se seleccionan padres, se cruzan con la probabilidad de cruce y cada hijo puede mutar. Un evento por generación resume la población; también se registran un cruce y una mutación representativos (los primeros de la generación).'),
      h('p', {}, 'Toda la aleatoriedad usa un generador con semilla: la misma configuración reproduce exactamente la misma evolución. Un algoritmo genético NO garantiza el óptimo global; por eso se compara con una solución exacta (búsqueda exhaustiva, programación dinámica o Held-Karp) cuando es factible.'),
      h('p', {}, 'Selección por ruleta: como exige pesos no negativos, se usa la aptitud desplazada (aptitud − peor + 1 % del rango). Diversidad: distancia media entre pares (Hamming normalizada para cadenas binarias; fracción de aristas no compartidas para rutas), calculada sobre los 40 primeros individuos.'),
    ];
    const layout = createLabLayout({ title: this.title, summary: this.summary, help });
    container.append(layout.root);

    const problemSelect = select([
      { value: 'function', label: 'Maximizar f(x) = x·sin(10πx) + 1' },
      { value: 'knapsack', label: 'Mochila 0/1 (ejemplo, 15 objetos)' },
      { value: 'knapsack-random', label: 'Mochila 0/1 aleatoria' },
      { value: 'tsp', label: 'Viajante (TSP)' },
    ], 'function', () => { updateFields(); prepare(); });
    const instanceSeed = numberInput(7, { min: 0, max: 999999999, onchange: () => prepare() });
    const instanceSize = numberInput(9, { min: 4, max: 40, onchange: () => prepare() });
    const instanceFields = h('div', {}, h('div', { class: 'inline-fields' }, field('Semilla instancia', instanceSeed), field('Tamaño (objetos/ciudades)', instanceSize)));

    const inputs = {
      populationSize: numberInput(DEFAULT_CONFIG.populationSize, { min: 2, max: 2000 }),
      maxGenerations: numberInput(DEFAULT_CONFIG.maxGenerations, { min: 1, max: 5000 }),
      mutationRate: numberInput(DEFAULT_CONFIG.mutationRate, { min: 0, max: 1, step: 0.005 }),
      crossoverRate: numberInput(DEFAULT_CONFIG.crossoverRate, { min: 0, max: 1, step: 0.05 }),
      tournamentSize: numberInput(DEFAULT_CONFIG.tournamentSize, { min: 2, max: 50 }),
      elitism: numberInput(DEFAULT_CONFIG.elitism, { min: 0, max: 100 }),
      seed: numberInput(1, { min: 0, max: 999999999 }),
      stagnation: numberInput(0, { min: 0, max: 5000 }),
    };
    for (const input of Object.values(inputs)) input.addEventListener('change', () => prepare());
    const selectionSelect = select(Object.entries(SELECTION_METHODS).map(([value, label]) => ({ value, label })), 'tournament', () => prepare());
    let stopAtOptimum = false;
    const optimumCheck = checkbox('Detener al alcanzar el óptimo exacto', false, (v) => { stopAtOptimum = v; prepare(); });

    layout.params.append(
      paramGroup('Problema', field('Problema', problemSelect), instanceFields),
      paramGroup('Configuración',
        h('div', { class: 'inline-fields' }, field('Población', inputs.populationSize), field('Generaciones máx.', inputs.maxGenerations)),
        h('div', { class: 'inline-fields' }, field('Prob. mutación', inputs.mutationRate), field('Prob. cruce', inputs.crossoverRate)),
        field('Selección', selectionSelect),
        h('div', { class: 'inline-fields' }, field('Tamaño torneo', inputs.tournamentSize), field('Elitismo', inputs.elitism)),
        h('div', { class: 'inline-fields' }, field('Semilla', inputs.seed), field('Estancamiento', inputs.stagnation)),
        h('small', { class: 'hint' }, 'Estancamiento: generaciones sin mejora para parar (0 = desactivado). La probabilidad de mutación es por gen (bit) en las cadenas binarias y se multiplica por la longitud para la inversión en rutas.'),
        optimumCheck),
    );

    const problemInfo = h('div', { class: 'problem-info' });
    const chartBox = h('div');
    const diversityBox = h('div');
    const problemView = h('div');
    const operatorsBox = h('div');
    const exactBox = h('div');
    layout.visual.append(problemInfo, exactBox,
      h('h3', {}, 'Aptitud por generación'), chartBox,
      h('div', { class: 'chart-legend' }, h('span', { class: 'l1' }, 'mejor'), h('span', { class: 'l2' }, 'media'), h('span', { class: 'l3' }, 'peor'), h('span', {}, '- - óptimo exacto')),
      h('h3', {}, 'Diversidad de la población'), diversityBox,
      h('h3', {}, 'Mejor individuo'), problemView);

    const panel = createRunPanel({ metricLabels: METRIC_LABELS, eventTypeLabels: EVENT_LABELS, onRender: (state, controller) => render(state, controller) });
    layout.side.append(panel.controlsElement, panel.metricsElement);
    layout.below.append(panel.logElement, h('section', { class: 'panel' }, h('h3', {}, 'Cruce y mutación representativos'), operatorsBox));

    let problem = null;
    let exact = null;
    // La referencia exacta solo depende de la instancia: se calcula una vez por instancia.
    const exactCache = new Map();

    function buildProblem() {
      switch (problemSelect.value) {
        case 'function': return functionProblem();
        case 'knapsack': return knapsackProblem(DEFAULT_KNAPSACK);
        case 'knapsack-random': return knapsackProblem(randomKnapsack(readInt(instanceSeed, 'La semilla de la instancia', 0, 999999999), { items: readInt(instanceSize, 'El tamaño', 4, 40) }));
        case 'tsp': return tspProblem(randomCities(readInt(instanceSeed, 'La semilla de la instancia', 0, 999999999), readInt(instanceSize, 'El número de ciudades', 4, 30)));
        default: throw new Error('Problema desconocido');
      }
    }

    function readConfig() {
      const population = readInt(inputs.populationSize, 'La población', 2, 2000);
      return {
        populationSize: population,
        maxGenerations: readInt(inputs.maxGenerations, 'Las generaciones', 1, 5000),
        mutationRate: readFloat(inputs.mutationRate, 'La probabilidad de mutación', 0, 1),
        crossoverRate: readFloat(inputs.crossoverRate, 'La probabilidad de cruce', 0, 1),
        selection: selectionSelect.value,
        tournamentSize: readInt(inputs.tournamentSize, 'El tamaño de torneo', 2, population),
        elitism: readInt(inputs.elitism, 'El elitismo', 0, population - 1),
        seed: readInt(inputs.seed, 'La semilla', 0, 999999999),
        stagnation: readInt(inputs.stagnation, 'El estancamiento', 0, 5000),
        targetFitness: null,
      };
    }

    function updateFields() {
      instanceFields.hidden = !['knapsack-random', 'tsp'].includes(problemSelect.value);
    }

    function prepare() {
      showMessage(layout.messages, null);
      try {
        problem = buildProblem();
        const key = `${problemSelect.value}|${instanceSeed.value}|${instanceSize.value}`;
        if (!exactCache.has(key)) {
          const t0 = now();
          const value = problem.exact();
          exactCache.set(key, { value, time: now() - t0 });
        }
        exact = exactCache.get(key).value;
        const exactTime = exactCache.get(key).time;
        const config = readConfig();
        if (stopAtOptimum && exact) config.targetFitness = exact.fitness;
        clear(problemInfo).append(
          h('p', {}, h('strong', {}, 'Objetivo: '), problem.objective),
          h('p', {}, h('strong', {}, 'Restricciones y representación: '), problem.constraints),
          h('p', { class: 'hint' }, h('strong', {}, 'Limitaciones: '), problem.limitations));
        clear(exactBox).append(exact
          ? h('div', { class: 'notice' }, `Referencia exacta (${exact.method}, ${formatMs(exactTime)}): aptitud ${problem.formatFitness(exact.fitness)} — ${exact.description}.`)
          : h('div', { class: 'notice notice-warn' }, 'No se calcula la solución exacta: el problema es demasiado grande para un método exacto en el navegador (TSP con más de 12 ciudades).'));
        const p = problem;
        panel.load({ createRun: () => geneticAlgorithm(p, config), model: geneticModel(), maxEvents: 60000, checkpointInterval: 200 });
      } catch (error) {
        panel.unload();
        showMessage(layout.messages, error.message, 'error');
      }
    }

    function render(state, controller) {
      if (!problem || !state) return;
      const hist = state.history;
      clear(chartBox);
      clear(diversityBox);
      if (hist.length) {
        chartBox.append(lineChart([
          { values: hist.map((r) => r.best), className: 's1', label: 'mejor' },
          { values: hist.map((r) => r.mean), className: 's2', label: 'media' },
          { values: hist.map((r) => r.worst), className: 's3', label: 'peor' },
        ], { xLabel: 'generación', yLabel: 'aptitud', reference: exact ? { value: exact.fitness, label: 'óptimo' } : null }));
        diversityBox.append(lineChart([{ values: hist.map((r) => r.diversity), className: 's4', label: 'diversidad' }], { height: 160, xLabel: 'generación', yLabel: 'diversidad' }));
      } else chartBox.append(h('p', { class: 'muted' }, 'Inicia la ejecución para ver la evolución.'));

      clear(problemView);
      const best = state.bestEver;
      if (best) {
        const fitness = problem.fitness(best);
        const gap = exact ? exact.fitness - fitness : null;
        problemView.append(h('p', {}, problem.describe(best)),
          exact ? h('p', { class: gap <= 1e-9 ? 'notice notice-ok' : 'notice' }, gap <= 1e-9 ? 'El mejor individuo alcanza el óptimo exacto.' : `Diferencia con el óptimo exacto: ${problem.formatFitness(gap)} (${formatNumber((gap / Math.abs(exact.fitness || 1)) * 100, 2)} %).`) : null);
        if (problem.id === 'function' && state.population) {
          const bx = problem.decode(best);
          problemView.append(scatterChart(state.population, { xRange: [problem.min, problem.max], curve: problem.f, highlight: [bx, problem.f(bx)] }),
            h('p', { class: 'hint' }, 'Curva: f(x). Puntos: población de la generación actual. Punto verde: mejor individuo histórico.'));
        }
        if (problem.id === 'knapsack') {
          problemView.append(h('div', { class: 'chips' }, problem.items.map((it, i) => h('span', { class: `chip${best[i] ? ' assigned' : ''}`, title: `peso ${it.weight}, valor ${it.value}` }, `${it.name} (${it.weight}/${it.value})`))),
            h('p', { class: 'hint' }, `Peso ${problem.weightOf(best)} de ${problem.capacity}. Etiquetas: nombre (peso/valor).`));
        }
        if (problem.id === 'tsp') problemView.append(renderRoute(problem, best, exact?.individual));
      }
      clear(operatorsBox);
      if (state.crossover) operatorsBox.append(h('h4', {}, `Cruce (${state.crossover.detail})`), h('div', { class: 'genome' }, `Padre 1: ${problem.encode(state.crossover.parents[0])}`), h('div', { class: 'genome' }, `Padre 2: ${problem.encode(state.crossover.parents[1])}`), h('div', { class: 'genome' }, `Hijo 1:  ${problem.encode(state.crossover.children[0])}`));
      if (state.mutation) operatorsBox.append(h('h4', {}, `Mutación (${state.mutation.changes.join(', ')})`), h('div', { class: 'genome' }, `Antes:   ${problem.encode(state.mutation.before)}`), h('div', { class: 'genome' }, `Después: ${problem.encode(state.mutation.after)}`));
      if (!state.crossover && !state.mutation) operatorsBox.append(h('p', { class: 'muted' }, 'Avanza hasta un evento de cruce o mutación para verlo aquí.'));
      if (state.stop) operatorsBox.append(h('div', { class: 'notice notice-ok' }, `Motivo de finalización: ${state.stop.reason}`));
      if (controller?.isComplete && controller.result) {
        operatorsBox.append(h('p', { class: 'hint' }, `Mejor aptitud ${problem.formatFitness(controller.result.bestFitness)} encontrada en la generación ${controller.result.bestGeneration}; ${formatNumber(controller.result.metrics.evaluations)} evaluaciones.`));
      }
    }

    updateFields();
    prepare();
    return () => panel.dispose();
  },
};

function renderRoute(problem, perm, optimal) {
  const W = 420;
  const P = 16;
  const sx = (x) => P + (x / 100) * (W - 2 * P);
  const draw = (route, cls, dash) => {
    const full = [0, ...route, 0];
    return svg('polyline', { points: full.map((c) => `${sx(problem.cities[c].x)},${sx(problem.cities[c].y)}`).join(' '), class: `series ${cls}`, 'stroke-dasharray': dash ?? null });
  };
  const root = svg('svg', { viewBox: `0 0 ${W} ${W}`, class: 'chart', style: 'max-width:420px', role: 'img', 'aria-label': 'Ruta del mejor individuo' });
  if (optimal) root.append(draw(optimal, 'ref', '5 4'));
  root.append(draw(perm, 's1'));
  problem.cities.forEach((c, i) => {
    root.append(svg('circle', { cx: sx(c.x), cy: sx(c.y), r: i === 0 ? 7 : 5, class: i === 0 ? 'dot best' : 'dot' }), svg('text', { x: sx(c.x) + 8, y: sx(c.y) - 6 }, c.name));
  });
  return h('div', {}, root, h('p', { class: 'hint' }, 'Línea continua: mejor ruta del AG. Discontinua: ruta óptima exacta (si se calculó). Ciudad A (verde): origen fijo.'));
}
