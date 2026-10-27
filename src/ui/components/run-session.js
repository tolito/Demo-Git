import { ExecutionController, Status } from '../../core/execution-controller.js';
import { formatNumber } from '../../utils/format.js';
import { clear, frameThrottle, h } from '../dom.js';

/**
 * Panel común de ejecución: controles de reproducción, métricas, registro de
 * eventos navegable e inspector del evento actual. Cada laboratorio crea una
 * sesión por ejecución y le pasa una función de renderizado de su vista.
 *
 * Los controles se conectan a un ExecutionController; la vista se redibuja
 * como mucho una vez por fotograma.
 */

const STATUS_LABEL = {
  [Status.IDLE]: 'Preparado',
  [Status.RUNNING]: 'Ejecutando',
  [Status.PAUSED]: 'En pausa',
  [Status.FINISHED]: 'Terminado',
  [Status.STOPPED]: 'Detenido',
  [Status.ERROR]: 'Error',
};

const ROW_HEIGHT = 26;

export function createRunPanel({ metricLabels = {}, onRender, eventTypeLabels = {} }) {
  let controller = null;
  let unsubscribe = null;
  let renderResult = null;

  // ------------------------------------------------------------- controles
  const buttons = {
    play: h('button', { class: 'btn primary', type: 'button', title: 'Iniciar / reanudar (barra espaciadora)' }, '▶ Iniciar'),
    pause: h('button', { class: 'btn', type: 'button', title: 'Pausar (barra espaciadora)' }, '⏸ Pausar'),
    back: h('button', { class: 'btn', type: 'button', title: 'Retroceder un paso (flecha izquierda)', 'aria-label': 'Retroceder un paso' }, '⏮'),
    step: h('button', { class: 'btn', type: 'button', title: 'Avanzar un paso (flecha derecha)', 'aria-label': 'Avanzar un paso' }, '⏭'),
    end: h('button', { class: 'btn', type: 'button', title: 'Ejecutar hasta terminar' }, '⏩ Hasta el final'),
    stop: h('button', { class: 'btn danger', type: 'button', title: 'Detener la ejecución' }, '⏹ Detener'),
    reset: h('button', { class: 'btn', type: 'button', title: 'Reiniciar la ejecución desde el principio' }, '↺ Reiniciar'),
  };
  const speedInput = h('input', { type: 'range', min: '0', max: '100', value: '35', 'aria-label': 'Velocidad' });
  const speedLabel = h('output', { class: 'speed-label' });
  const statusLabel = h('span', { class: 'status-pill', role: 'status', 'aria-live': 'polite' }, 'Sin ejecución');
  const positionLabel = h('span', { class: 'position-label' });
  const scrubber = h('input', { type: 'range', min: '0', max: '0', value: '0', class: 'scrubber', 'aria-label': 'Paso actual' });
  const notice = h('div', { class: 'run-notice' });

  // Velocidad en escala logarítmica: 1 .. 5000 eventos por segundo.
  const sliderToSpeed = (v) => Math.round(10 ** (Number(v) / 100 * Math.log10(5000)));
  const updateSpeedLabel = () => { speedLabel.textContent = `${sliderToSpeed(speedInput.value)} pasos/s`; };
  updateSpeedLabel();

  const controls = h('div', { class: 'run-controls', role: 'toolbar', 'aria-label': 'Controles de ejecución' },
    h('div', { class: 'button-row' }, buttons.play, buttons.pause, buttons.back, buttons.step, buttons.end, buttons.stop, buttons.reset),
    h('div', { class: 'speed-row' }, h('label', {}, 'Velocidad ', speedInput), speedLabel),
    h('div', { class: 'scrub-row' }, scrubber, positionLabel, statusLabel),
    notice);

  // ------------------------------------------------------------- métricas
  const metricsGrid = h('dl', { class: 'metrics-grid' });
  const metricsBox = h('section', { class: 'panel metrics', 'aria-label': 'Métricas' }, h('h3', {}, 'Métricas en tiempo real'), metricsGrid);

  // ------------------------------------------------------------- registro
  const logViewport = h('div', { class: 'log-viewport', tabindex: '0', role: 'listbox', 'aria-label': 'Registro de eventos' });
  const logSpacer = h('div', { class: 'log-spacer' });
  const logRows = h('div', { class: 'log-rows' });
  logViewport.append(logSpacer, logRows);
  const followCheckbox = h('input', { type: 'checkbox', checked: true });
  const inspector = h('div', { class: 'inspector' }, h('p', { class: 'muted' }, 'Selecciona un paso del registro para inspeccionarlo.'));
  const logBox = h('section', { class: 'panel log', 'aria-label': 'Registro de eventos' },
    h('div', { class: 'log-header' }, h('h3', {}, 'Registro de operaciones'), h('label', { class: 'check small' }, followCheckbox, ' seguir el paso actual')),
    logViewport,
    h('h4', {}, 'Inspector del paso'),
    inspector);

  const render = frameThrottle(() => {
    if (!controller) return;
    renderControls();
    renderMetrics();
    renderLog();
    renderInspector();
    onRender?.(controller.state, controller);
  });

  function renderControls() {
    const c = controller;
    const status = c.status;
    statusLabel.textContent = STATUS_LABEL[status];
    statusLabel.dataset.status = status;
    buttons.play.textContent = c.position === 0 ? '▶ Iniciar' : '▶ Reanudar';
    buttons.play.disabled = status === Status.RUNNING || !c.canStepForward;
    buttons.pause.disabled = status !== Status.RUNNING;
    buttons.step.disabled = status === Status.RUNNING || !c.canStepForward;
    buttons.back.disabled = status === Status.RUNNING || !c.canStepBack;
    buttons.end.disabled = status === Status.RUNNING || !c.canStepForward;
    buttons.stop.disabled = status === Status.STOPPED || status === Status.ERROR || c.isComplete;
    buttons.reset.disabled = c.generatedEvents === 0 && status === Status.IDLE;
    scrubber.max = String(Math.max(c.storedEvents, c.position));
    scrubber.value = String(c.position);
    scrubber.disabled = status === Status.RUNNING;
    positionLabel.textContent = `Paso ${formatNumber(c.position)} de ${formatNumber(c.generatedEvents)}${c.isComplete ? '' : '+'}`;
    const messages = [];
    if (c.error) messages.push(h('div', { class: 'notice notice-error', role: 'alert' }, `Error durante la ejecución: ${c.error.message}`));
    if (c.truncated) {
      messages.push(h('div', { class: 'notice notice-warn' },
        `Se alcanzó el límite de ${formatNumber(c.maxEvents)} eventos almacenados. La ejecución continúa y la vista se actualiza, pero ya no se puede retroceder. Reinicia para volver al principio.`));
    }
    if (status === Status.STOPPED) messages.push(h('div', { class: 'notice notice-info' }, 'Ejecución detenida. Puedes revisar los pasos registrados o reiniciar.'));
    clear(notice).append(...messages);
  }

  function renderMetrics() {
    const event = controller.currentEvent;
    const metrics = event?.metrics ?? controller.result?.metrics ?? {};
    clear(metricsGrid);
    const keys = Object.keys(metricLabels).length ? Object.keys(metricLabels) : Object.keys(metrics);
    for (const key of keys) {
      if (!(key in metrics)) continue;
      metricsGrid.append(h('div', { class: 'metric' }, h('dt', {}, metricLabels[key] ?? key), h('dd', {}, formatNumber(metrics[key], 3))));
    }
    if (!metricsGrid.firstChild) metricsGrid.append(h('p', { class: 'muted' }, 'Las métricas aparecerán al avanzar.'));
  }

  function renderLog() {
    const history = controller.history;
    logSpacer.style.height = `${history.length * ROW_HEIGHT}px`;
    const current = controller.position; // el paso k es history[k - 1]
    if (followCheckbox.checked && current > 0) {
      const top = (current - 1) * ROW_HEIGHT;
      const view = logViewport.clientHeight || 260;
      if (top < logViewport.scrollTop || top > logViewport.scrollTop + view - ROW_HEIGHT) {
        logViewport.scrollTop = Math.max(0, top - view / 2);
      }
    }
    drawLogRows();
  }

  function drawLogRows() {
    if (!controller) return;
    const history = controller.history;
    const view = logViewport.clientHeight || 260;
    const first = Math.max(0, Math.floor(logViewport.scrollTop / ROW_HEIGHT) - 5);
    const last = Math.min(history.length, first + Math.ceil(view / ROW_HEIGHT) + 10);
    clear(logRows);
    logRows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    for (let i = first; i < last; i++) {
      const event = history[i];
      const isCurrent = event.step === controller.position;
      logRows.append(h('div', {
        class: `log-row${isCurrent ? ' current' : ''}${event.step > controller.position ? ' future' : ''}`,
        role: 'option',
        'aria-selected': isCurrent ? 'true' : 'false',
        title: event.message,
        dataset: { step: String(event.step), type: event.type },
      },
      h('span', { class: 'log-step' }, String(event.step)),
      h('span', { class: `log-type type-${event.type}` }, eventTypeLabels[event.type] ?? event.type),
      h('span', { class: 'log-msg' }, event.message)));
    }
  }

  function renderInspector() {
    const event = controller.currentEvent;
    clear(inspector);
    if (!event) {
      inspector.append(h('p', { class: 'muted' }, controller.position === 0 ? 'Estado inicial: todavía no se ha ejecutado ninguna operación.' : 'Sin evento.'));
      return;
    }
    const data = summarizeData(event.data);
    inspector.append(
      h('p', {}, h('strong', {}, `Paso ${event.step} · ${eventTypeLabels[event.type] ?? event.type}`)),
      h('p', {}, event.message),
      data.length ? h('dl', { class: 'kv' }, data.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null,
    );
  }

  logViewport.addEventListener('scroll', () => drawLogRows());
  logRows.addEventListener('click', (e) => {
    const row = e.target.closest('.log-row');
    if (!row || !controller) return;
    followCheckbox.checked = false;
    controller.goTo(Number(row.dataset.step));
  });
  logViewport.addEventListener('keydown', (e) => {
    if (!controller) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); controller.stepForward(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); controller.stepBack(); }
  });

  // ------------------------------------------------------------- acciones
  buttons.play.addEventListener('click', () => controller?.play());
  buttons.pause.addEventListener('click', () => controller?.pause());
  buttons.step.addEventListener('click', () => controller?.stepForward());
  buttons.back.addEventListener('click', () => controller?.stepBack());
  buttons.end.addEventListener('click', () => controller?.runToEnd());
  buttons.stop.addEventListener('click', () => controller?.stop());
  buttons.reset.addEventListener('click', () => controller?.reset());
  speedInput.addEventListener('input', () => {
    updateSpeedLabel();
    controller?.setSpeed(sliderToSpeed(speedInput.value));
  });
  scrubber.addEventListener('input', () => controller?.goTo(Number(scrubber.value)));

  /** Atajos de teclado globales mientras el panel está montado. */
  function onKey(e) {
    if (!controller || !root.isConnected) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag) || e.target.isContentEditable) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (controller.status === Status.RUNNING) controller.pause();
      else controller.play();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      controller.stepForward();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      controller.stepBack();
    }
  }
  document.addEventListener('keydown', onKey);

  const root = h('div', { class: 'run-panel' }, controls);

  return {
    controlsElement: root,
    metricsElement: metricsBox,
    logElement: logBox,
    get controller() { return controller; },
    /**
     * Crea una ejecución nueva y descarta la anterior (sin dejar temporizadores).
     * options: { createRun, model, maxEvents, checkpointInterval }
     */
    load(options) {
      this.unload();
      controller = new ExecutionController(options);
      controller.setSpeed(sliderToSpeed(speedInput.value));
      unsubscribe = controller.subscribe(() => render());
      render();
      render.flush();
      return controller;
    },
    unload() {
      render.cancel();
      unsubscribe?.();
      unsubscribe = null;
      controller?.dispose();
      controller = null;
      renderResult = null;
      clear(notice);
      clear(logRows);
      logSpacer.style.height = '0px';
      clear(metricsGrid);
      clear(inspector).append(h('p', { class: 'muted' }, 'Sin ejecución activa.'));
      statusLabel.textContent = 'Sin ejecución';
      delete statusLabel.dataset.status;
      positionLabel.textContent = '';
      for (const b of Object.values(buttons)) b.disabled = true;
      scrubber.disabled = true;
    },
    refresh() {
      render();
    },
    dispose() {
      this.unload();
      document.removeEventListener('keydown', onKey);
    },
    get lastRender() { return renderResult; },
  };
}

/** Convierte los datos de un evento en pares clave/valor legibles y acotados. */
function summarizeData(data) {
  if (!data) return [];
  const out = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'state' || key === 'population' || key === 'bestIndividual' || key === 'bestEverIndividual') continue;
    let text;
    if (value === null || value === undefined) text = '—';
    else if (typeof value === 'number') text = formatNumber(value, 4);
    else if (Array.isArray(value)) text = value.length > 24 ? `[${value.slice(0, 24).join(', ')}, …] (${value.length})` : `[${value.join(', ')}]`;
    else if (typeof value === 'object') {
      const json = JSON.stringify(value);
      text = json.length > 160 ? `${json.slice(0, 160)}…` : json;
    } else text = String(value);
    out.push([key, text]);
  }
  return out;
}
