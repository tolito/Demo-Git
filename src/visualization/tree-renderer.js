import { svg } from '../ui/dom.js';

/**
 * Dibujo del árbol minimax/alfa-beta en SVG. La disposición se calcula a partir
 * del estado del modelo: las hojas (incluidas las ramas podadas) se colocan de
 * izquierda a derecha y cada nodo interno se centra sobre sus hijos.
 */
const fmt = (v) => (v === null || v === undefined ? '' : v === Infinity ? '+∞' : v === -Infinity ? '−∞' : String(v));

export function renderTree(state, { showBounds = true, onSelect = null } = {}) {
  if (!state || state.rootId === null) {
    return svg('svg', { class: 'tree-svg', viewBox: '0 0 300 60', width: 300, height: 60 },
      svg('text', { x: 10, y: 35 }, 'El árbol aparecerá al ejecutar.'));
  }
  const nodes = state.nodes;
  // 1) contar hojas para decidir el tamaño
  const layout = new Map();
  let leafCount = 0;
  let maxDepth = 0;
  const visit = (id, depth) => {
    const node = nodes.get(id);
    maxDepth = Math.max(maxDepth, depth);
    const kids = node.children.filter((c) => nodes.has(c));
    const slots = [];
    for (const c of kids) slots.push(visit(c, depth + 1));
    for (let k = 0; k < node.pruned.length; k++) {
      slots.push(leafCount++);
      maxDepth = Math.max(maxDepth, depth + 1);
    }
    let x;
    if (slots.length === 0) x = leafCount++;
    else x = (slots[0] + slots[slots.length - 1]) / 2;
    layout.set(id, { x, depth, prunedSlots: slots.slice(kids.length) });
    return x;
  };
  visit(state.rootId, 0);

  const compact = leafCount > 60;
  const dx = compact ? Math.max(6, Math.min(18, 2400 / Math.max(1, leafCount))) : 46;
  const dy = compact ? 46 : 74;
  const r = compact ? 5 : 15;
  const pad = compact ? 12 : 34;
  const width = Math.max(300, leafCount * dx + 2 * pad);
  const height = (maxDepth + 1) * dy + 2 * pad;
  const X = (slot) => pad + slot * dx + dx / 2;
  const Y = (depth) => pad + depth * dy;

  const root = svg('svg', { class: 'tree-svg', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Árbol de búsqueda' });
  const edges = svg('g');
  const shapes = svg('g');
  root.append(edges, shapes);

  // Camino elegido: desde la raíz siguiendo bestChild hasta donde llegue.
  const chosenPath = new Set();
  if (state.chosen !== null) {
    let id = state.rootId;
    while (id !== null && id !== undefined && nodes.has(id)) {
      chosenPath.add(id);
      id = nodes.get(id).bestChild;
    }
  }

  for (const [id, pos] of layout) {
    const node = nodes.get(id);
    const x = X(pos.x);
    const y = Y(pos.depth);
    if (node.parentId !== null && layout.has(node.parentId)) {
      const p = layout.get(node.parentId);
      const best = chosenPath.has(id) && chosenPath.has(node.parentId);
      edges.append(svg('line', { x1: X(p.x), y1: Y(p.depth) + r, x2: x, y2: y - r, class: `edge${best ? ' best' : ''}` }));
      if (!compact && node.moveLabel !== null) {
        edges.append(svg('text', { x: (X(p.x) + x) / 2 + 3, y: (Y(p.depth) + y) / 2, class: 'move', 'font-size': 9, fill: 'currentColor' }, node.moveLabel));
      }
    }
    pos.prunedSlots.forEach((slot, k) => {
      const px = X(slot);
      const py = Y(pos.depth + 1);
      edges.append(svg('line', { x1: x, y1: y + r, x2: px, y2: py - r, class: 'edge pruned' }));
      const g = svg('g', { class: 'node pruned' },
        svg('rect', { x: px - r * 0.8, y: py - r * 0.8, width: r * 1.6, height: r * 1.6, class: 'node-shape' }),
        svg('title', {}, `Rama podada: ${node.pruned[k]}`));
      if (!compact) g.append(svg('text', { x: px, y: py + 4, 'text-anchor': 'middle', class: 'label' }, '✂'));
      shapes.append(g);
    });

    const classes = ['node', node.isMax ? 'max' : 'min'];
    if (node.status === 'active') classes.push('active');
    if (state.current === id) classes.push('current');
    if (chosenPath.has(id) && id !== state.rootId) classes.push('chosen');
    const shape = node.isMax
      ? svg('polygon', { points: `${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`, class: 'node-shape' })
      : svg('polygon', { points: `${x},${y + r} ${x + r},${y - r * 0.8} ${x - r},${y - r * 0.8}`, class: 'node-shape' });
    const valueText = node.value === null ? '' : `${node.bound === 'lower' ? '≥' : node.bound === 'upper' ? '≤' : ''}${fmt(node.value)}${node.exact === false ? '*' : ''}`;
    const g = svg('g', { class: classes.join(' '), tabindex: compact ? null : '0' }, shape);
    g.append(svg('title', {}, describe(node)));
    if (!compact) {
      g.append(svg('text', { x, y: y + (node.isMax ? 5 : 1), 'text-anchor': 'middle', class: 'label' }, valueText));
      if (showBounds && (node.alpha !== -Infinity || node.beta !== Infinity) && node.alpha !== undefined) {
        g.append(svg('text', { x, y: y + r + 11, 'text-anchor': 'middle', class: 'bounds' }, `α${fmt(node.alpha)} β${fmt(node.beta)}`));
      }
    }
    if (onSelect) g.addEventListener('click', () => onSelect(node));
    shapes.append(g);
  }
  return root;
}

function describe(node) {
  const lines = [`Nodo ${node.id} (${node.isMax ? 'MAX' : 'MIN'}, profundidad ${node.depth})`];
  if (node.moveLabel) lines.push(`Jugada: ${node.moveLabel}`);
  if (node.value !== null) {
    lines.push(`Valor: ${fmt(node.value)}${node.bound === 'lower' ? ' (cota inferior tras poda)' : node.bound === 'upper' ? ' (cota superior tras poda)' : ''}${node.exact === false ? ' (incluye evaluación heurística)' : ''}`);
  }
  if (node.alpha !== undefined) lines.push(`α = ${fmt(node.alpha)}, β = ${fmt(node.beta)}`);
  if (node.pruned.length) lines.push(`Ramas podadas: ${node.pruned.join(', ')}`);
  if (node.board) {
    const b = node.board.map((c) => c ?? '·');
    lines.push(`${b.slice(0, 3).join(' ')}\n${b.slice(3, 6).join(' ')}\n${b.slice(6, 9).join(' ')}`);
  }
  return lines.join('\n');
}
