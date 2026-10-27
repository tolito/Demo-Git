import { svg } from '../ui/dom.js';

/**
 * Gráficos SVG sencillos y sin dependencias: líneas y barras con barras de error.
 */

function niceRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.06;
  return [min - pad, max + pad];
}

function fmtTick(v) {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * series: [{ values: number[], className: 's1', label }]
 * options: { width, height, xLabel, yLabel, reference: { value, label } }
 */
export function lineChart(series, { width = 640, height = 260, xLabel = '', yLabel = '', reference = null, xValues = null } = {}) {
  const left = 56;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (reference && Number.isFinite(reference.value)) all.push(reference.value);
  const [ymin, ymax] = niceRange(Math.min(...all), Math.max(...all));
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const X = (i) => left + (n <= 1 ? 0 : (i / (n - 1)) * (width - left - right));
  const Y = (v) => top + (1 - (v - ymin) / (ymax - ymin)) * (height - top - bottom);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': yLabel || 'Gráfico' });
  for (let k = 0; k <= 4; k++) {
    const v = ymin + ((ymax - ymin) * k) / 4;
    root.append(svg('line', { x1: left, x2: width - right, y1: Y(v), y2: Y(v), class: 'gridline' }),
      svg('text', { x: left - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmtTick(v)));
  }
  root.append(svg('line', { x1: left, x2: left, y1: top, y2: height - bottom, class: 'axis' }),
    svg('line', { x1: left, x2: width - right, y1: height - bottom, y2: height - bottom, class: 'axis' }));
  const ticks = Math.min(6, n);
  for (let k = 0; k < ticks; k++) {
    const i = Math.round((k * (n - 1)) / Math.max(1, ticks - 1));
    root.append(svg('text', { x: X(i), y: height - bottom + 14, 'text-anchor': 'middle' }, String(xValues ? xValues[i] : i)));
  }
  if (xLabel) root.append(svg('text', { x: (left + width - right) / 2, y: height - 4, 'text-anchor': 'middle' }, xLabel));
  if (reference && Number.isFinite(reference.value)) {
    root.append(svg('line', { x1: left, x2: width - right, y1: Y(reference.value), y2: Y(reference.value), class: 'ref' }),
      svg('text', { x: width - right - 4, y: Y(reference.value) - 4, 'text-anchor': 'end' }, reference.label));
  }
  for (const s of series) {
    const pts = s.values.map((v, i) => (Number.isFinite(v) ? `${X(i).toFixed(1)},${Y(v).toFixed(1)}` : null)).filter(Boolean);
    if (pts.length) root.append(svg('polyline', { points: pts.join(' '), class: `series ${s.className}` }));
  }
  return root;
}

/** Diagrama de dispersión: points [[x, y]], highlight: [x, y] opcional, curve: fn(x). */
export function scatterChart(points, { width = 640, height = 240, xRange, curve = null, highlight = null } = {}) {
  const left = 48;
  const right = 12;
  const top = 10;
  const bottom = 26;
  const [x0, x1] = xRange ?? niceRange(Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0])));
  const samples = [];
  if (curve) for (let k = 0; k <= 400; k++) { const x = x0 + ((x1 - x0) * k) / 400; samples.push([x, curve(x)]); }
  const ys = [...points.map((p) => p[1]), ...samples.map((p) => p[1])];
  const [y0, y1] = niceRange(Math.min(...ys), Math.max(...ys));
  const X = (x) => left + ((x - x0) / (x1 - x0)) * (width - left - right);
  const Y = (y) => top + (1 - (y - y0) / (y1 - y0)) * (height - top - bottom);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': 'Población sobre la función objetivo' });
  root.append(svg('line', { x1: left, x2: width - right, y1: height - bottom, y2: height - bottom, class: 'axis' }),
    svg('text', { x: left, y: height - 8 }, String(x0)), svg('text', { x: width - right, y: height - 8, 'text-anchor': 'end' }, String(x1)),
    svg('text', { x: left - 6, y: Y(y1) + 10, 'text-anchor': 'end' }, fmtTick(y1)), svg('text', { x: left - 6, y: Y(y0), 'text-anchor': 'end' }, fmtTick(y0)));
  if (samples.length) root.append(svg('polyline', { points: samples.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' '), class: 'series s2' }));
  for (const [x, y] of points) root.append(svg('circle', { cx: X(x), cy: Y(y), r: 3.5, class: 'dot' }));
  if (highlight) root.append(svg('circle', { cx: X(highlight[0]), cy: Y(highlight[1]), r: 6, class: 'dot best' }));
  return root;
}

/** Barras con media ± desviación típica. bars: [{ label, mean, std }] */
export function barChart(bars, { width = 640, height = 260, yLabel = '' } = {}) {
  const left = 64;
  const right = 12;
  const top = 14;
  const bottom = 56;
  const hi = Math.max(0, ...bars.map((b) => (Number.isFinite(b.mean) ? b.mean + (b.std || 0) : 0)));
  const lo = Math.min(0, ...bars.map((b) => (Number.isFinite(b.mean) ? b.mean - (b.std || 0) : 0)));
  const [ymin, ymax] = lo === hi ? [0, 1] : [lo, hi * 1.08 || 1];
  const Y = (v) => top + (1 - (v - ymin) / (ymax - ymin)) * (height - top - bottom);
  const slot = (width - left - right) / Math.max(1, bars.length);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': yLabel || 'Gráfico de barras' });
  for (let k = 0; k <= 4; k++) {
    const v = ymin + ((ymax - ymin) * k) / 4;
    root.append(svg('line', { x1: left, x2: width - right, y1: Y(v), y2: Y(v), class: 'gridline' }), svg('text', { x: left - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmtTick(v)));
  }
  bars.forEach((b, i) => {
    const cx = left + slot * i + slot / 2;
    const w = Math.min(60, slot * 0.6);
    if (Number.isFinite(b.mean)) {
      const y = Y(Math.max(0, b.mean));
      const h0 = Math.abs(Y(b.mean) - Y(0));
      root.append(svg('rect', { x: cx - w / 2, y: b.mean >= 0 ? y : Y(0), width: w, height: Math.max(1, h0), class: 'bar' }, svg('title', {}, `${b.label}: ${b.mean} ± ${b.std}`)));
      if (b.std > 0) {
        root.append(svg('line', { x1: cx, x2: cx, y1: Y(b.mean - b.std), y2: Y(b.mean + b.std), class: 'errbar' }),
          svg('line', { x1: cx - 6, x2: cx + 6, y1: Y(b.mean + b.std), y2: Y(b.mean + b.std), class: 'errbar' }),
          svg('line', { x1: cx - 6, x2: cx + 6, y1: Y(b.mean - b.std), y2: Y(b.mean - b.std), class: 'errbar' }));
      }
    }
    const label = b.label.length > 22 ? `${b.label.slice(0, 21)}…` : b.label;
    root.append(svg('text', { x: cx, y: height - bottom + 16, 'text-anchor': 'middle' }, label));
  });
  if (yLabel) root.append(svg('text', { x: left, y: height - 8 }, yLabel));
  return root;
}
