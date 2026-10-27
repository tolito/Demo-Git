import { summarize } from '../utils/stats.js';
import { normalizeParams } from './definitions.js';

/**
 * Ejecución por lotes de un experimento. Cede el control entre repeticiones
 * para no bloquear la interfaz y se puede cancelar con un objeto
 * { cancelled: boolean }.
 */
export async function runExperiment(def, rawParams, { onProgress = () => {}, token = { cancelled: false }, yieldFn = defaultYield } = {}) {
  const params = normalizeParams(def, rawParams);
  const context = def.prepare ? def.prepare(params) : null;
  const rows = [];
  for (let i = 0; i < params.runs; i++) {
    if (token.cancelled) return { params, rows, cancelled: true };
    rows.push(...def.run(params, i, context));
    onProgress(i + 1, params.runs);
    await yieldFn();
  }
  return { params, rows, cancelled: false };
}

function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Estadísticas agregadas por variante: n, media, desviación típica (muestral),
 * mínimo, máximo y mediana de cada métrica. Los valores no numéricos (p. ej.
 * coste de un mapa sin solución) se excluyen y n lo refleja.
 */
export function aggregate(rows, metrics) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  return [...groups].map(([group, list]) => {
    const stats = {};
    for (const m of metrics) {
      stats[m.key] = summarize(list.map((r) => (r[m.key] === null || r[m.key] === undefined ? NaN : Number(r[m.key]))));
    }
    return { group, runs: list.length, stats };
  });
}
