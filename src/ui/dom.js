/**
 * Utilidades mínimas para construir DOM sin frameworks.
 *   h('button', { class: 'btn', onclick: fn }, 'Texto')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Campo de formulario con etiqueta accesible. */
export function field(label, control, hint = null) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    control,
    hint ? h('small', { class: 'hint' }, hint) : null);
}

export function select(options, value, onchange) {
  const el = h('select', { onchange: onchange ? () => onchange(el.value) : undefined },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  return el;
}

export function numberInput(value, { min, max, step = 1, onchange } = {}) {
  const el = h('input', { type: 'number', value: String(value), min, max, step, inputmode: 'numeric' });
  if (onchange) el.addEventListener('change', () => onchange(Number(el.value)));
  return el;
}

export function checkbox(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked });
  if (onchange) input.addEventListener('change', () => onchange(input.checked));
  return h('label', { class: 'check' }, input, ' ', label);
}

/** Lee un entero de un input validando el rango; lanza un error legible. */
export function readInt(input, label, min, max) {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

export function readFloat(input, label, min, max) {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} debe ser un número entre ${min} y ${max}.`);
  }
  return value;
}

/** Programa una función como mucho una vez por fotograma. */
export function frameThrottle(fn) {
  let pending = false;
  let lastArgs = null;
  const raf = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
  const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
  let handle = null;
  const wrapped = (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    handle = raf(() => {
      pending = false;
      handle = null;
      fn(...lastArgs);
    });
  };
  wrapped.cancel = () => {
    if (handle !== null) cancel(handle);
    pending = false;
    handle = null;
  };
  wrapped.flush = () => {
    wrapped.cancel();
    if (lastArgs) fn(...lastArgs);
  };
  return wrapped;
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Muestra un mensaje de estado/error dentro de un contenedor. */
export function showMessage(container, message, kind = 'info') {
  clear(container);
  if (!message) return;
  container.append(h('div', { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message));
}

/** Ejecuta fn y muestra el error en `container` si falla (sin ocultarlo). */
export function guard(container, fn) {
  try {
    const out = fn();
    if (out && typeof out.catch === 'function') {
      return out.catch((error) => {
        console.error(error);
        showMessage(container, error.message, 'error');
      });
    }
    return out;
  } catch (error) {
    console.error(error);
    showMessage(container, error.message, 'error');
    return undefined;
  }
}

/** Cede el control al navegador (para trabajos largos troceados). */
export function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
