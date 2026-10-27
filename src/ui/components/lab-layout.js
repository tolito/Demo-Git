import { h } from '../dom.js';

/**
 * Estructura común de un laboratorio:
 *   cabecera (título, resumen, ayuda contextual plegable)
 *   columna de parámetros | área visual principal | controles, métricas y registro
 */
export function createLabLayout({ title, summary, help }) {
  const params = h('aside', { class: 'lab-params panel', 'aria-label': 'Parámetros' });
  const visual = h('section', { class: 'lab-visual panel', 'aria-label': 'Visualización' });
  const side = h('section', { class: 'lab-side', 'aria-label': 'Ejecución' });
  const below = h('section', { class: 'lab-below' });
  const messages = h('div', { class: 'lab-messages', 'aria-live': 'polite' });
  const helpBox = help
    ? h('details', { class: 'help' }, h('summary', {}, 'Ayuda: cómo funciona'), h('div', { class: 'help-body' }, help))
    : null;
  const root = h('div', { class: 'lab' },
    h('header', { class: 'lab-header' }, h('h2', {}, title), h('p', { class: 'lab-summary' }, summary), helpBox),
    messages,
    h('div', { class: 'lab-grid' }, params, visual, side),
    below);
  return { root, params, visual, side, below, messages };
}

/** Grupo de parámetros con título. */
export function paramGroup(title, ...children) {
  return h('fieldset', { class: 'param-group' }, h('legend', {}, title), ...children);
}

/** Leyenda de colores. items: [{ className | color, label }] */
export function legend(items) {
  return h('ul', { class: 'legend', 'aria-label': 'Leyenda' },
    items.map((it) => h('li', {}, h('span', { class: `swatch ${it.className ?? ''}`, style: it.color ? { background: it.color } : undefined }), it.label)));
}

/** Tabla simple a partir de filas y columnas { key, label, format }. */
export function table(columns, rows, { caption } = {}) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data-table' },
      caption ? h('caption', {}, caption) : null,
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', title: c.title ?? null }, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.__class ?? null }, columns.map((c) => h('td', {}, c.format ? c.format(r[c.key], r) : String(r[c.key] ?? '—'))))))));
}

/** Pestañas accesibles. tabs: [{ id, label }]. */
export function tabs(items, active, onSelect) {
  const list = h('div', { class: 'tabs', role: 'tablist' });
  for (const item of items) {
    const button = h('button', {
      type: 'button',
      role: 'tab',
      class: `tab${item.id === active ? ' active' : ''}`,
      'aria-selected': item.id === active ? 'true' : 'false',
      onclick: () => onSelect(item.id),
    }, item.label);
    list.append(button);
  }
  return list;
}
