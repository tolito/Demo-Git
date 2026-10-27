import { EXPERIMENTS, getExperiment, normalizeParams } from '../../experiments/definitions.js';
import { aggregate, runExperiment } from '../../experiments/runner.js';
import { barChart } from '../../visualization/charts.js';
import { toCSV, toJSON } from '../../utils/export.js';
import { formatNumber } from '../../utils/format.js';
import { loadJSON, saveJSON } from '../../utils/storage.js';
import { clear, downloadText, field, guard, h, select, showMessage } from '../dom.js';
import { createLabLayout, paramGroup, table } from '../components/lab-layout.js';

const STORAGE_KEY = 'experiment-configs';

export const experimentsLab = {
  id: 'experiments',
  title: 'Experimentos',
  summary: 'Experimentos reproducibles con semillas controladas: varias repeticiones, estadísticas agregadas, gráficos y exportación a CSV/JSON.',
  highlights: ['Media, desviación típica y n por variante', 'Misma instancia para todas las variantes', 'Configuraciones guardadas en el navegador'],
  mount(container) {
    const help = [
      h('p', {}, 'Cada repetición i usa la semilla «semilla inicial + i» para generar la instancia (mapa, Sudoku, grafo, árbol o semilla del AG). Dentro de una repetición todas las variantes se ejecutan sobre la misma instancia, así que sus métricas y tiempos son comparables.'),
      h('p', {}, 'La tabla de resultados individuales muestra cada ejecución; la tabla agregada muestra, por variante, el número de valores válidos (n), la media, la desviación típica muestral, el mínimo y el máximo. Los tiempos son tiempos de pared en este navegador, sin trazas: son orientativos.'),
      h('p', {}, 'Las métricas de recuento (nodos, comprobaciones...) son deterministas para una semilla dada; los tiempos varían entre ejecuciones y equipos.'),
    ];
    const layout = createLabLayout({ title: this.title, summary: this.summary, help });
    container.append(layout.root);
    layout.root.querySelector('.lab-grid').classList.add('two-col');

    const experimentSelect = select(EXPERIMENTS.map((e) => ({ value: e.id, label: e.name })), EXPERIMENTS[0].id, () => buildForm());
    const description = h('p', { class: 'algo-description' });
    const formBox = h('div');
    const runButton = h('button', { type: 'button', class: 'btn primary' }, 'Ejecutar experimento');
    const cancelButton = h('button', { type: 'button', class: 'btn danger', disabled: true }, 'Cancelar');
    const progress = h('progress', { max: 1, value: 0, style: { width: '100%' } });
    const progressLabel = h('span', { class: 'hint' });
    const configName = h('input', { type: 'text', placeholder: 'Nombre de la configuración' });
    const savedBox = h('div');

    layout.params.append(
      paramGroup('Experimento', field('Experimento', experimentSelect), description, formBox),
      paramGroup('Ejecución', h('div', { class: 'button-row' }, runButton, cancelButton), progress, progressLabel),
      paramGroup('Configuraciones guardadas', field('Nombre', configName),
        h('button', { type: 'button', class: 'btn small', onclick: () => guard(layout.messages, saveConfig) }, 'Guardar configuración'),
        savedBox),
    );

    const resultArea = h('div', {}, h('p', { class: 'muted' }, 'Configura un experimento y pulsa «Ejecutar experimento».'));
    layout.visual.append(resultArea);
    layout.side.remove();

    let inputs = {};
    let token = null;
    let lastResult = null;

    function buildForm(values = {}) {
      const def = getExperiment(experimentSelect.value);
      description.textContent = def.description;
      clear(formBox);
      inputs = {};
      for (const p of def.params) {
        const value = values[p.key] ?? p.default;
        let control;
        if (p.type === 'select') control = select(p.options, value);
        else control = h('input', { type: 'number', min: p.min, max: p.max, step: p.type === 'float' ? 'any' : '1', value: String(value) });
        inputs[p.key] = control;
        formBox.append(field(p.label, control));
      }
    }

    function readParams() {
      const def = getExperiment(experimentSelect.value);
      const raw = {};
      for (const p of def.params) raw[p.key] = p.type === 'select' ? inputs[p.key].value : Number(inputs[p.key].value);
      return normalizeParams(def, raw);
    }

    async function run() {
      const def = getExperiment(experimentSelect.value);
      const params = readParams();
      showMessage(layout.messages, null);
      token = { cancelled: false };
      runButton.disabled = true;
      cancelButton.disabled = false;
      progress.value = 0;
      const started = performance.now();
      try {
        const result = await runExperiment(def, params, {
          token,
          onProgress: (done, total) => {
            progress.value = done / total;
            progressLabel.textContent = `${done} de ${total} repeticiones`;
          },
        });
        if (!resultArea.isConnected) return;
        lastResult = { experiment: def.id, name: def.name, ...result, elapsedMs: performance.now() - started, date: new Date().toISOString() };
        renderResults(def, lastResult);
        if (result.cancelled) showMessage(layout.messages, `Experimento cancelado: se muestran las ${new Set(result.rows.map((r) => r.run)).size} repeticiones completadas.`, 'warn');
      } finally {
        runButton.disabled = false;
        cancelButton.disabled = true;
        token = null;
      }
    }

    function renderResults(def, result) {
      const agg = aggregate(result.rows, def.metrics);
      const metricSelect = select(def.metrics.map((m) => ({ value: m.key, label: m.label })), def.metrics[1]?.key ?? def.metrics[0].key, () => drawChart());
      const chartBox = h('div');
      const drawChart = () => {
        const key = metricSelect.value;
        clear(chartBox).append(barChart(agg.map((a) => ({ label: a.group, mean: a.stats[key].mean, std: a.stats[key].std })), { yLabel: `${def.metrics.find((m) => m.key === key).label}: media ± desviación típica` }));
      };
      const fmtStat = (s) => (s.n === 0 ? '—' : `${formatNumber(s.mean, 3)} ± ${formatNumber(s.std, 3)}`);
      const aggRows = agg.map((a) => {
        const row = { group: a.group, runs: a.runs };
        for (const m of def.metrics) row[m.key] = a.stats[m.key];
        return row;
      });
      const rawColumns = ['group', 'run', 'seed', ...def.metrics.map((m) => m.key)];
      const shown = result.rows.slice(0, 300);
      clear(resultArea).append(
        h('h3', {}, `${def.name}`),
        h('p', { class: 'hint' }, `Parámetros: ${Object.entries(result.params).map(([k, v]) => `${k} = ${v}`).join(', ')}. Duración total: ${formatNumber(result.elapsedMs / 1000, 2)} s.`),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', class: 'btn small', onclick: () => downloadText(`${def.id}-resultados.csv`, toCSV(result.rows, rawColumns), 'text/csv') }, 'Exportar CSV (ejecuciones)'),
          h('button', { type: 'button', class: 'btn small', onclick: () => downloadText(`${def.id}-agregado.csv`, toCSV(agg.flatMap((a) => def.metrics.map((m) => ({ variante: a.group, metrica: m.key, n: a.stats[m.key].n, media: a.stats[m.key].mean, desviacion: a.stats[m.key].std, minimo: a.stats[m.key].min, maximo: a.stats[m.key].max })))), 'text/csv') }, 'Exportar CSV (agregado)'),
          h('button', { type: 'button', class: 'btn small', onclick: () => downloadText(`${def.id}.json`, toJSON({ ...result, aggregate: agg }), 'application/json') }, 'Exportar JSON')),
        h('h4', {}, 'Estadísticas agregadas (media ± desviación típica muestral; n = valores válidos)'),
        table([
          { key: 'group', label: 'Variante' },
          { key: 'runs', label: 'Ejecuciones' },
          ...def.metrics.map((m) => ({ key: m.key, label: m.label, format: (s) => h('span', { title: `n = ${s.n}, mín. ${formatNumber(s.min, 3)}, máx. ${formatNumber(s.max, 3)}, mediana ${formatNumber(s.median, 3)}` }, fmtStat(s), h('br'), h('small', { class: 'muted' }, `n = ${s.n}`)) })),
        ], aggRows),
        h('h4', {}, 'Gráfico'),
        field('Métrica', metricSelect),
        chartBox,
        h('details', {}, h('summary', {}, `Resultados individuales (${result.rows.length} filas${result.rows.length > shown.length ? `, se muestran ${shown.length}` : ''})`),
          table(rawColumns.map((k) => ({ key: k, label: def.metrics.find((m) => m.key === k)?.label ?? k, format: (v) => (typeof v === 'number' ? formatNumber(v, 4) : String(v ?? '—')) })), shown)),
      );
      drawChart();
    }

    function savedConfigs() {
      const loaded = loadJSON(STORAGE_KEY, []);
      if (!loaded.ok) showMessage(layout.messages, `No se pudo leer el almacenamiento local: ${loaded.error.message}`, 'warn');
      return Array.isArray(loaded.value) ? loaded.value : [];
    }

    function saveConfig() {
      const name = configName.value.trim();
      if (!name) throw new Error('Escribe un nombre para la configuración.');
      const params = readParams();
      const list = savedConfigs().filter((c) => c.name !== name);
      list.push({ name, experiment: experimentSelect.value, params, savedAt: new Date().toISOString() });
      const result = saveJSON(STORAGE_KEY, list);
      if (!result.ok) throw new Error(`No se pudo guardar: ${result.error.message}`);
      showMessage(layout.messages, `Configuración «${name}» guardada en este navegador.`, 'ok');
      renderSaved();
    }

    function renderSaved() {
      const list = savedConfigs();
      clear(savedBox);
      if (!list.length) {
        savedBox.append(h('p', { class: 'hint' }, 'No hay configuraciones guardadas.'));
        return;
      }
      for (const cfg of list) {
        const exp = EXPERIMENTS.find((e) => e.id === cfg.experiment);
        savedBox.append(h('div', { class: 'button-row', style: { marginTop: '6px' } },
          h('span', { class: 'hint', style: { flex: '1' } }, `${cfg.name} · ${exp?.name ?? cfg.experiment}`),
          h('button', { type: 'button', class: 'btn small', onclick: () => { experimentSelect.value = cfg.experiment; buildForm(cfg.params); configName.value = cfg.name; } }, 'Cargar'),
          h('button', { type: 'button', class: 'btn small danger', onclick: () => guard(layout.messages, () => {
            const res = saveJSON(STORAGE_KEY, savedConfigs().filter((c) => c.name !== cfg.name));
            if (!res.ok) throw new Error(`No se pudo borrar: ${res.error.message}`);
            renderSaved();
          }) }, 'Borrar')));
      }
    }

    runButton.addEventListener('click', () => guard(layout.messages, run));
    cancelButton.addEventListener('click', () => { if (token) token.cancelled = true; });
    buildForm();
    renderSaved();
    return () => { if (token) token.cancelled = true; };
  },
};
