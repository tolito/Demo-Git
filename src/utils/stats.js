/** Estadística descriptiva para agregar resultados de varias ejecuciones. */

export function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Desviación típica muestral (n − 1); 0 si solo hay un valor. */
export function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

export function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    n: finite.length,
    mean: mean(finite),
    std: std(finite),
    min: finite.length ? Math.min(...finite) : NaN,
    max: finite.length ? Math.max(...finite) : NaN,
    median: median(finite),
  };
}
