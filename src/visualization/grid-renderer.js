import { CELL } from './models.js';

/**
 * Dibujo de la cuadrícula en un <canvas>. Se usa Canvas (no SVG) porque las
 * cuadrículas pueden tener decenas de miles de celdas y se redibujan en cada
 * fotograma durante la reproducción.
 */

function cssColor(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

export function readPalette(el) {
  return {
    empty: cssColor(el, '--cell-empty', '#ffffff'),
    grid: cssColor(el, '--cell-grid', '#e5e7eb'),
    wall: cssColor(el, '--cell-wall', '#1f2937'),
    frontier: cssColor(el, '--cell-frontier', 'rgba(250, 204, 21, 0.75)'),
    visited: cssColor(el, '--cell-visited', 'rgba(96, 165, 250, 0.55)'),
    current: cssColor(el, '--cell-current', '#f97316'),
    path: cssColor(el, '--cell-path', '#16a34a'),
    start: cssColor(el, '--cell-start', '#7c3aed'),
    goal: cssColor(el, '--cell-goal', '#dc2626'),
    terrain3: cssColor(el, '--terrain-3', '#d9f99d'),
    terrain5: cssColor(el, '--terrain-5', '#d6b98c'),
    terrain9: cssColor(el, '--terrain-9', '#93c5fd'),
    text: cssColor(el, '--text', '#111827'),
  };
}

function terrainColor(palette, cost) {
  if (cost >= 9) return palette.terrain9;
  if (cost >= 5) return palette.terrain5;
  if (cost >= 2) return palette.terrain3;
  return palette.empty;
}

/** Calcula el tamaño de celda para que la cuadrícula quepa en el ancho disponible. */
export function layoutGrid(grid, availableWidth, maxHeight = 640) {
  const cell = Math.max(3, Math.min(36, Math.floor(Math.min(availableWidth / grid.width, maxHeight / grid.height))));
  return { cell, width: cell * grid.width, height: cell * grid.height };
}

export function drawGrid(canvas, grid, state, { cell, palette, focus = -1 }) {
  const dpr = globalThis.devicePixelRatio || 1;
  const width = cell * grid.width;
  const height = cell * grid.height;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.grid;
  ctx.fillRect(0, 0, width, height);
  const gap = cell >= 8 ? 1 : 0;
  const n = grid.width * grid.height;

  for (let i = 0; i < n; i++) {
    const x = (i % grid.width) * cell;
    const y = Math.floor(i / grid.width) * cell;
    if (grid.walls[i]) {
      ctx.fillStyle = palette.wall;
      ctx.fillRect(x, y, cell, cell);
      continue;
    }
    ctx.fillStyle = terrainColor(palette, grid.costs[i]);
    ctx.fillRect(x, y, cell - gap, cell - gap);
    if (state) {
      const s = state.cells[i];
      if (s === CELL.VISITED) {
        ctx.fillStyle = palette.visited;
        ctx.fillRect(x, y, cell - gap, cell - gap);
      } else if (s === CELL.FRONTIER) {
        ctx.fillStyle = palette.frontier;
        ctx.fillRect(x, y, cell - gap, cell - gap);
      }
    }
    if (grid.costs[i] > 1 && cell >= 16) {
      ctx.fillStyle = palette.text;
      ctx.globalAlpha = 0.45;
      ctx.font = `${Math.floor(cell * 0.38)}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(grid.costs[i]), x + cell - 3, y + cell - 2);
      ctx.globalAlpha = 1;
    }
  }

  if (state?.path?.length) {
    ctx.fillStyle = palette.path;
    for (const i of state.path) {
      const x = (i % grid.width) * cell;
      const y = Math.floor(i / grid.width) * cell;
      const inset = Math.max(1, Math.floor(cell * 0.22));
      ctx.fillRect(x + inset, y + inset, cell - 2 * inset - gap, cell - 2 * inset - gap);
    }
    ctx.strokeStyle = palette.path;
    ctx.lineWidth = Math.max(1.5, cell * 0.12);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    state.path.forEach((i, k) => {
      const cx = (i % grid.width) * cell + cell / 2;
      const cy = Math.floor(i / grid.width) * cell + cell / 2;
      if (k === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  }

  if (state && state.current >= 0) {
    const x = (state.current % grid.width) * cell;
    const y = Math.floor(state.current / grid.width) * cell;
    ctx.strokeStyle = palette.current;
    ctx.lineWidth = Math.max(2, cell * 0.15);
    ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, cell - ctx.lineWidth - gap, cell - ctx.lineWidth - gap);
  }

  for (const [index, color, label] of [[grid.start, palette.start, 'O'], [grid.goal, palette.goal, 'D']]) {
    const x = (index % grid.width) * cell;
    const y = Math.floor(index / grid.width) * cell;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, cell - gap, cell - gap);
    if (cell >= 12) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.floor(cell * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + cell / 2, y + cell / 2 + 1);
    }
  }

  if (focus >= 0) {
    const x = (focus % grid.width) * cell;
    const y = Math.floor(focus / grid.width) * cell;
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.setLineDash([]);
  }
}

/** Índice de celda a partir de coordenadas de puntero relativas al canvas. */
export function cellFromPoint(grid, cell, offsetX, offsetY) {
  const x = Math.floor(offsetX / cell);
  const y = Math.floor(offsetY / cell);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
  return y * grid.width + x;
}
