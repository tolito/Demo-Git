/**
 * Acceso a localStorage con errores explícitos (modo privado, cuota llena...).
 * Las funciones devuelven { ok, value | error } en lugar de ocultar fallos.
 */
const PREFIX = 'algorithm-lab:';

function storage() {
  return globalThis.localStorage ?? null;
}

export function loadJSON(key, fallback) {
  const s = storage();
  if (!s) return { ok: false, value: fallback, error: new Error('El almacenamiento local no está disponible.') };
  try {
    const raw = s.getItem(PREFIX + key);
    return { ok: true, value: raw === null ? fallback : JSON.parse(raw) };
  } catch (error) {
    return { ok: false, value: fallback, error };
  }
}

export function saveJSON(key, value) {
  const s = storage();
  if (!s) return { ok: false, error: new Error('El almacenamiento local no está disponible.') };
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
