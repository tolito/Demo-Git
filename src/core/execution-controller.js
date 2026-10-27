/**
 * Controlador de ejecución paso a paso.
 *
 * El algoritmo se ejecuta de forma perezosa: cada avance extrae el siguiente
 * evento del generador, es decir, el algoritmo realmente avanza una operación.
 * Los eventos extraídos se guardan en un historial para poder retroceder.
 *
 * Retroceso: en lugar de copiar el estado completo en cada paso se guardan
 * puntos de control (snapshots) cada `checkpointInterval` eventos. Para volver al
 * paso k se restaura el último punto de control <= k y se reaplican los eventos
 * intermedios. El coste de un retroceso es O(checkpointInterval) aplicaciones.
 *
 * Límite de memoria: solo se almacenan `maxEvents` eventos. Si el algoritmo
 * produce más, la ejecución puede continuar (el estado visual se sigue
 * actualizando) pero no se puede retroceder más allá del último evento guardado.
 *
 * El "modelo" traduce eventos a un estado visual sin tocar el DOM:
 *   { init(): state, apply(state, event): void, clone(state): state }
 */

export const Status = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished',
  STOPPED: 'stopped',
  ERROR: 'error',
});

const defaultScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  now: () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
};

export class ExecutionController {
  #createRun;
  #model;
  #scheduler;
  #maxEvents;
  #checkpointInterval;
  #chunkBudgetMs;

  #generator = null;
  #history = [];
  #checkpoints = new Map();
  #state = null;
  #position = 0;
  #generated = 0;
  #lastEvent = null;
  #generatorDone = false;
  #result = undefined;
  #error = null;
  #status = Status.IDLE;
  #timer = null;
  #speed = 10;
  #truncated = false;
  #listeners = new Set();
  #runToken = 0;
  #mode = 'play';
  #fastResolve = null;

  constructor({
    createRun,
    model,
    maxEvents = 200000,
    checkpointInterval = 400,
    chunkBudgetMs = 14,
    scheduler = defaultScheduler,
  }) {
    if (typeof createRun !== 'function') throw new TypeError('createRun debe ser una función que devuelva un generador.');
    if (!model || typeof model.init !== 'function' || typeof model.apply !== 'function' || typeof model.clone !== 'function') {
      throw new TypeError('El modelo debe implementar init, apply y clone.');
    }
    this.#createRun = createRun;
    this.#model = model;
    this.#scheduler = scheduler;
    this.#maxEvents = maxEvents;
    this.#checkpointInterval = Math.max(1, checkpointInterval);
    this.#chunkBudgetMs = chunkBudgetMs;
    this.#initialise();
  }

  // ---------------------------------------------------------------- consulta

  get status() { return this.#status; }
  get position() { return this.#position; }
  get state() { return this.#state; }
  get result() { return this.#result; }
  get error() { return this.#error; }
  get speed() { return this.#speed; }
  get history() { return this.#history; }
  get storedEvents() { return this.#history.length; }
  get generatedEvents() { return this.#generated; }
  get isComplete() { return this.#generatorDone; }
  get truncated() { return this.#truncated; }
  get maxEvents() { return this.#maxEvents; }
  get currentEvent() { return this.#position === 0 ? null : this.#lastEvent; }
  get atEnd() { return this.#generatorDone && this.#position >= this.#generated; }
  /**
   * Una vez superado el límite de eventos almacenados no se permite retroceder:
   * los eventos posteriores al límite no se guardaron y no podrían reproducirse
   * de nuevo para volver al final.
   */
  get canStepBack() { return this.#position > 0 && !this.#truncated; }
  get canStepForward() {
    if (this.#status === Status.ERROR) return false;
    if (this.#status === Status.STOPPED) return this.#position < this.#history.length;
    return !this.atEnd;
  }

  /** Instantánea de solo lectura del estado del controlador. */
  inspect() {
    return {
      status: this.#status,
      position: this.#position,
      generated: this.#generated,
      stored: this.#history.length,
      complete: this.#generatorDone,
      truncated: this.#truncated,
      speed: this.#speed,
      event: this.currentEvent,
      result: this.#result,
      error: this.#error,
    };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---------------------------------------------------------------- control

  /** Inicia o reanuda la reproducción automática a la velocidad actual. */
  play() {
    if (this.#status === Status.ERROR || this.#status === Status.STOPPED) return;
    if (this.atEnd) {
      this.#setStatus(Status.FINISHED);
      return;
    }
    this.#cancelTimer();
    this.#runToken++;
    this.#mode = 'play';
    this.#setStatus(Status.RUNNING);
    this.#scheduleTick();
  }

  start() { this.play(); }
  resume() { this.play(); }

  pause() {
    this.#cancelTimer();
    if (this.#status === Status.RUNNING) this.#setStatus(Status.PAUSED);
  }

  /** Avanza un único evento. Devuelve true si se aplicó un evento. */
  stepForward() {
    this.#cancelTimer();
    const applied = this.#advance();
    if (this.#status !== Status.ERROR) {
      this.#setStatus(this.atEnd ? Status.FINISHED : (this.#position === 0 ? Status.IDLE : Status.PAUSED), true);
    }
    return applied;
  }

  /** Retrocede un evento. Devuelve false si no es posible. */
  stepBack() {
    this.#cancelTimer();
    if (!this.canStepBack) return false;
    this.#restore(this.#position - 1);
    if (this.#status !== Status.STOPPED) this.#setStatus(this.#position === 0 ? Status.IDLE : Status.PAUSED, true);
    else this.#notify();
    return true;
  }

  /**
   * Coloca el cursor en el paso indicado (0 = estado inicial). Hacia atrás usa
   * los puntos de control; hacia delante extrae eventos reales del algoritmo.
   */
  goTo(target) {
    this.#cancelTimer();
    const goal = Math.max(0, Math.floor(target));
    if (goal < this.#position) {
      if (!this.canStepBack) return false;
      this.#restore(goal);
    } else {
      while (this.#position < goal && this.#advance()) { /* avanzar */ }
    }
    if (this.#status !== Status.ERROR && this.#status !== Status.STOPPED) {
      this.#setStatus(this.atEnd ? Status.FINISHED : (this.#position === 0 ? Status.IDLE : Status.PAUSED), true);
    } else {
      this.#notify();
    }
    return true;
  }

  /**
   * Ejecuta hasta terminar en bloques de tiempo limitado para no bloquear la
   * interfaz. Devuelve una promesa que se resuelve al terminar o al cancelar.
   */
  runToEnd() {
    if (this.#status === Status.ERROR || this.#status === Status.STOPPED) return Promise.resolve(this.inspect());
    this.#cancelTimer();
    const token = ++this.#runToken;
    this.#mode = 'fast';
    this.#setStatus(Status.RUNNING);
    return new Promise((resolve) => {
      this.#fastResolve = resolve;
      const finish = () => {
        this.#fastResolve = null;
        resolve(this.inspect());
      };
      const chunk = () => {
        this.#timer = null;
        if (token !== this.#runToken || this.#status !== Status.RUNNING) {
          finish();
          return;
        }
        const started = this.#scheduler.now();
        while (this.#scheduler.now() - started < this.#chunkBudgetMs) {
          if (!this.#advance()) break;
        }
        if (this.#status === Status.ERROR) {
          finish();
          return;
        }
        if (this.atEnd || this.#position >= this.#generated && this.#generatorDone) {
          this.#setStatus(Status.FINISHED, true);
          finish();
          return;
        }
        if (this.#position > this.#history.length && this.#position < this.#generated) {
          // No se puede reproducir algo que no está almacenado.
          this.#setStatus(Status.PAUSED, true);
          finish();
          return;
        }
        this.#notify();
        this.#timer = this.#scheduler.setTimeout(chunk, 0);
      };
      this.#timer = this.#scheduler.setTimeout(chunk, 0);
    });
  }

  /** Versión síncrona (pruebas y cargas pequeñas). */
  runToEndSync(limit = Infinity) {
    this.#cancelTimer();
    let steps = 0;
    while (steps < limit && this.#advance()) steps++;
    if (this.#status !== Status.ERROR) this.#setStatus(this.atEnd ? Status.FINISHED : Status.PAUSED, true);
    return this.inspect();
  }

  /**
   * Detiene definitivamente la ejecución: cancela temporizadores y cierra el
   * generador (se ejecutan sus bloques finally). El historial sigue disponible
   * para inspección, pero el algoritmo no puede continuar.
   */
  stop() {
    this.#cancelTimer();
    this.#runToken++;
    this.#closeGenerator();
    if (!this.#generatorDone) this.#setStatus(Status.STOPPED);
    else this.#notify();
  }

  /** Vuelve al estado inicial con un generador nuevo. */
  reset() {
    this.#cancelTimer();
    this.#runToken++;
    this.#closeGenerator();
    this.#initialise();
    this.#notify();
  }

  /** Libera todo; tras llamar a dispose no deben quedar temporizadores activos. */
  dispose() {
    this.#cancelTimer();
    this.#runToken++;
    this.#closeGenerator();
    this.#listeners.clear();
  }

  /** Velocidad en eventos por segundo durante la reproducción automática. */
  setSpeed(eventsPerSecond) {
    const value = Number(eventsPerSecond);
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('La velocidad debe ser un número positivo.');
    this.#speed = value;
    if (this.#status === Status.RUNNING && this.#timer !== null && this.#mode === 'play') {
      // Reprograma con el nuevo intervalo solo si estamos en reproducción normal.
      this.#cancelTimer();
      this.#scheduleTick();
    }
    this.#notify();
  }

  hasActiveTimer() {
    return this.#timer !== null;
  }

  // ---------------------------------------------------------------- interno

  #initialise() {
    this.#generator = null;
    this.#history = [];
    this.#checkpoints = new Map();
    this.#state = this.#model.init();
    this.#checkpoints.set(0, this.#model.clone(this.#state));
    this.#position = 0;
    this.#generated = 0;
    this.#lastEvent = null;
    this.#generatorDone = false;
    this.#result = undefined;
    this.#error = null;
    this.#truncated = false;
    this.#status = Status.IDLE;
  }

  #ensureGenerator() {
    if (!this.#generator) {
      this.#generator = this.#createRun();
      if (!this.#generator || typeof this.#generator.next !== 'function') {
        throw new TypeError('createRun no devolvió un generador.');
      }
    }
    return this.#generator;
  }

  /** Extrae el siguiente evento real del algoritmo. */
  #pull() {
    if (this.#generatorDone) return null;
    let step;
    try {
      step = this.#ensureGenerator().next();
    } catch (error) {
      this.#fail(error);
      return null;
    }
    if (step.done) {
      this.#generatorDone = true;
      this.#result = step.value;
      this.#generator = null;
      return null;
    }
    const event = step.value;
    event.step = ++this.#generated;
    if (!this.#truncated && this.#history.length < this.#maxEvents) {
      this.#history.push(event);
    } else {
      this.#truncated = true;
    }
    return event;
  }

  #advance() {
    if (this.#status === Status.ERROR) return false;
    // Tras detener solo se puede recorrer el historial ya registrado.
    if (this.#status === Status.STOPPED && this.#position >= this.#history.length) return false;
    let event;
    if (this.#position < this.#history.length) {
      event = this.#history[this.#position];
    } else if (this.#position < this.#generated) {
      // Eventos no almacenados por el límite: no se pueden reproducir otra vez.
      return false;
    } else {
      event = this.#pull();
      if (!event) return false;
    }
    try {
      this.#model.apply(this.#state, event);
    } catch (error) {
      this.#fail(error);
      return false;
    }
    this.#position++;
    this.#lastEvent = event;
    if (this.#position % this.#checkpointInterval === 0
      && this.#position <= this.#history.length
      && !this.#checkpoints.has(this.#position)) {
      this.#checkpoints.set(this.#position, this.#model.clone(this.#state));
    }
    return true;
  }

  #restore(target) {
    let base = Math.floor(target / this.#checkpointInterval) * this.#checkpointInterval;
    while (base > 0 && !this.#checkpoints.has(base)) base -= this.#checkpointInterval;
    this.#state = this.#model.clone(this.#checkpoints.get(base));
    this.#position = base;
    while (this.#position < target) {
      const event = this.#history[this.#position];
      this.#model.apply(this.#state, event);
      this.#position++;
    }
    this.#lastEvent = this.#position > 0 ? this.#history[this.#position - 1] : null;
  }

  #scheduleTick() {
    // Intervalo mínimo de 16 ms; a altas velocidades se aplican varios eventos por tick.
    const interval = Math.max(16, 1000 / this.#speed);
    const perTick = Math.max(1, Math.round((this.#speed * interval) / 1000));
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = null;
      if (this.#status !== Status.RUNNING) return;
      for (let i = 0; i < perTick; i++) {
        if (!this.#advance()) break;
      }
      if (this.#status === Status.ERROR) return;
      if (this.atEnd) {
        this.#setStatus(Status.FINISHED, true);
        return;
      }
      if (this.#position >= this.#generated && this.#position > this.#history.length) {
        // No debería ocurrir; protección para no entrar en bucle.
        this.#setStatus(Status.PAUSED, true);
        return;
      }
      this.#notify();
      this.#scheduleTick();
    }, interval);
  }

  #cancelTimer() {
    if (this.#timer !== null) {
      this.#scheduler.clearTimeout(this.#timer);
      this.#timer = null;
    }
    // Una ejecución rápida pendiente se da por concluida (cancelada).
    if (this.#fastResolve) {
      const resolve = this.#fastResolve;
      this.#fastResolve = null;
      // Se resuelve tras completar la operación en curso (pausa, parada...)
      // para que el estado devuelto sea el definitivo.
      queueMicrotask(() => resolve(this.inspect()));
    }
  }

  #closeGenerator() {
    if (this.#generator) {
      try {
        this.#generator.return(undefined);
      } finally {
        this.#generator = null;
      }
    }
  }

  #fail(error) {
    this.#cancelTimer();
    this.#error = error instanceof Error ? error : new Error(String(error));
    this.#closeGenerator();
    this.#setStatus(Status.ERROR, true);
  }

  #setStatus(status, forceNotify = false) {
    const changed = this.#status !== status;
    this.#status = status;
    if (changed || forceNotify) this.#notify();
  }

  #notify() {
    for (const listener of this.#listeners) listener(this);
  }
}
