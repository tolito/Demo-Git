/** Exportación de tablas de resultados a CSV y JSON (sin dependencias del DOM). */

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' && !Number.isFinite(value) ? String(value) : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(rows, columns = null) {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const lines = [cols.map(csvCell).join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','));
  return lines.join('\n');
}

export function toJSON(data) {
  return JSON.stringify(data, (_key, value) => (typeof value === 'number' && !Number.isFinite(value) ? String(value) : value), 2);
}
