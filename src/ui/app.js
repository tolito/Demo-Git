import { clear, h } from './dom.js';
import { LABS } from './labs/index.js';
import { loadJSON, saveJSON } from '../utils/storage.js';

/**
 * Aplicación: navegación por hash (#/laboratorio), tema claro/oscuro y montaje
 * y desmontaje de laboratorios. Cada laboratorio devuelve una función de
 * limpieza que cancela ejecuciones, temporizadores y escuchadores.
 */

const main = document.getElementById('main');
const nav = document.getElementById('lab-nav');
const themeButton = document.getElementById('theme-toggle');
let unmount = null;

function renderNav(activeId) {
  clear(nav);
  const items = [{ id: 'home', title: 'Inicio' }, ...LABS];
  for (const lab of items) {
    nav.append(h('a', {
      href: `#/${lab.id}`,
      class: lab.id === activeId ? 'active' : '',
      'aria-current': lab.id === activeId ? 'page' : null,
    }, lab.navTitle ?? lab.title));
  }
}

function renderHome(container) {
  container.append(
    h('section', { class: 'home-hero' },
      h('h2', {}, 'Explora, ejecuta y compara algoritmos reales'),
      h('p', {}, 'Cada laboratorio ejecuta implementaciones reales paso a paso. Puedes pausar, avanzar, retroceder, inspeccionar cada operación y comparar métricas medidas durante la ejecución.')),
    h('div', { class: 'card-grid' }, LABS.map((lab) => h('a', { class: 'card', href: `#/${lab.id}` },
      h('h3', {}, lab.title),
      h('p', {}, lab.summary),
      lab.highlights ? h('ul', {}, lab.highlights.map((x) => h('li', {}, x))) : null,
      h('span', { class: 'card-cta' }, 'Abrir laboratorio →')))),
  );
  return null;
}

function route() {
  const id = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  if (unmount) {
    unmount();
    unmount = null;
  }
  clear(main);
  const lab = LABS.find((l) => l.id === id);
  renderNav(lab ? lab.id : 'home');
  if (!lab) {
    renderHome(main);
    document.title = 'Algorithm Lab';
    return;
  }
  document.title = `${lab.title} · Algorithm Lab`;
  try {
    unmount = lab.mount(main) ?? null;
  } catch (error) {
    console.error(error);
    main.append(h('div', { class: 'notice notice-error', role: 'alert' }, `No se pudo abrir el laboratorio: ${error.message}`));
  }
  main.focus({ preventScroll: true });
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const effective = theme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  themeButton.textContent = effective === 'dark' ? '☀ Modo claro' : '☾ Modo oscuro';
  themeButton.setAttribute('aria-pressed', effective === 'dark' ? 'true' : 'false');
}

themeButton.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme
    ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  const saved = saveJSON('theme', next);
  if (!saved.ok) console.warn('No se pudo guardar el tema:', saved.error);
});

applyTheme(loadJSON('theme', null).value);
// Si el usuario no ha elegido tema, se sigue la preferencia del sistema.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  applyTheme(document.documentElement.dataset.theme ?? null);
});
window.addEventListener('hashchange', route);
window.addEventListener('error', (e) => {
  const box = document.getElementById('global-error');
  box.hidden = false;
  box.textContent = `Error inesperado: ${e.message}`;
});
route();
