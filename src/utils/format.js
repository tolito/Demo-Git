/** Formato de números para la interfaz (separadores en español). */

const integer = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (typeof value !== 'number') return String(value);
  if (Number.isNaN(value)) return '—';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (Number.isInteger(value)) return integer.format(value);
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 10) return `${ms.toFixed(3)} ms`;
  return `${ms.toFixed(1)} ms`;
}
