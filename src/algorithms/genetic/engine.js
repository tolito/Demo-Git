import { createRng } from '../../core/rng.js';
import { makeEvent } from '../../core/trace.js';

/**
 * Motor genético genérico.
 *
 * Un problema define:
 *   randomIndividual(rng), fitness(ind) (a maximizar), crossover(a, b, rng) ->
 *   { children: [c1, c2], detail }, mutate(ind, rate, rng) -> { individual,
 *   changes: [...] }, isValid(ind), distance(a, b) en [0, 1], describe(ind),
 *   encode(ind) (texto breve del genotipo) y, opcionalmente, optimum (aptitud
 *   óptima conocida) para el criterio de parada por objetivo.
 *
 * Configuración:
 *   populationSize, maxGenerations, mutationRate, crossoverRate,
 *   selection: 'tournament' | 'roulette' | 'rank', tournamentSize,
 *   elitism (número de individuos copiados sin cambios), seed,
 *   stagnation (generaciones sin mejora para detenerse; 0 = desactivado),
 *   targetFitness (detenerse al alcanzarla; null = desactivado).
 *
 * Toda la aleatoriedad pasa por un único generador con semilla, de modo que
 * una misma configuración produce exactamente la misma evolución.
 */

export const SELECTION_METHODS = Object.freeze({
  tournament: 'Torneo',
  roulette: 'Ruleta (proporcional, con desplazamiento)',
  rank: 'Por rango (lineal)',
});

export function validateConfig(config) {
  const errors = [];
  const intIn = (key, min, max) => {
    const v = config[key];
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`${key} debe ser un entero entre ${min} y ${max}.`);
  };
  const probability = (key) => {
    const v = config[key];
    if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${key} debe estar entre 0 y 1.`);
  };
  intIn('populationSize', 2, 2000);
  intIn('maxGenerations', 1, 100000);
  probability('mutationRate');
  probability('crossoverRate');
  if (!SELECTION_METHODS[config.selection]) errors.push(`Método de selección desconocido: ${config.selection}.`);
  if (config.selection === 'tournament') intIn('tournamentSize', 2, Math.max(2, config.populationSize));
  intIn('elitism', 0, Math.max(0, config.populationSize - 1));
  intIn('stagnation', 0, 100000);
  return { valid: errors.length === 0, errors };
}

export const DEFAULT_CONFIG = Object.freeze({
  populationSize: 60,
  maxGenerations: 150,
  mutationRate: 0.02,
  crossoverRate: 0.9,
  selection: 'tournament',
  tournamentSize: 3,
  elitism: 2,
  seed: 1,
  stagnation: 0,
  targetFitness: null,
});

function statistics(fitness) {
  let best = -Infinity;
  let worst = Infinity;
  let sum = 0;
  let bestIndex = 0;
  for (let i = 0; i < fitness.length; i++) {
    const f = fitness[i];
    sum += f;
    if (f > best) {
      best = f;
      bestIndex = i;
    }
    if (f < worst) worst = f;
  }
  const mean = sum / fitness.length;
  let variance = 0;
  for (const f of fitness) variance += (f - mean) ** 2;
  return { best, worst, mean, std: Math.sqrt(variance / fitness.length), bestIndex };
}

/** Distancia media entre pares de (como mucho) los 40 primeros individuos. */
function diversity(problem, population) {
  const sample = population.slice(0, Math.min(40, population.length));
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      total += problem.distance(sample[i], sample[j]);
      pairs++;
    }
  }
  return pairs ? total / pairs : 0;
}

export function* geneticAlgorithm(problem, userConfig = {}, { trace = true } = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const { valid, errors } = validateConfig(config);
  if (!valid) throw new Error(errors.join(' '));
  const rng = createRng(config.seed);
  const metrics = { generation: 0, evaluations: 0, crossovers: 0, mutations: 0, bestFitness: -Infinity, meanFitness: 0, diversity: 0 };

  const evaluate = (ind) => {
    metrics.evaluations++;
    return problem.fitness(ind);
  };

  let population = Array.from({ length: config.populationSize }, () => problem.randomIndividual(rng));
  let fitness = population.map(evaluate);
  const history = [];
  let bestEver = null;
  let bestEverFitness = -Infinity;
  let bestEverGeneration = 0;
  let stopReason = null;

  function select(stats) {
    const n = population.length;
    if (config.selection === 'tournament') {
      let winner = rng.int(0, n - 1);
      for (let k = 1; k < config.tournamentSize; k++) {
        const challenger = rng.int(0, n - 1);
        if (fitness[challenger] > fitness[winner]) winner = challenger;
      }
      return winner;
    }
    if (config.selection === 'roulette') {
      // La ruleta exige pesos no negativos: se desplaza la aptitud restando la
      // peor (más un pequeño margen para que el peor tenga probabilidad > 0).
      const span = stats.best - stats.worst;
      if (span <= 0) return rng.int(0, n - 1);
      const epsilon = span * 0.01;
      let total = 0;
      for (const f of fitness) total += f - stats.worst + epsilon;
      let r = rng.next() * total;
      for (let i = 0; i < n; i++) {
        r -= fitness[i] - stats.worst + epsilon;
        if (r <= 0) return i;
      }
      return n - 1;
    }
    // Rango lineal: el peor tiene peso 1 y el mejor peso n.
    const order = rankOrder ?? (rankOrder = fitness.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]));
    const total = (n * (n + 1)) / 2;
    let r = rng.next() * total;
    for (let rank = 0; rank < n; rank++) {
      r -= rank + 1;
      if (r <= 0) return order[rank];
    }
    return order[n - 1];
  }
  let rankOrder = null;

  for (let generation = 0; ; generation++) {
    const stats = statistics(fitness);
    const div = diversity(problem, population);
    if (stats.best > bestEverFitness + 1e-12) {
      bestEverFitness = stats.best;
      bestEver = population[stats.bestIndex];
      bestEverGeneration = generation;
    }
    metrics.generation = generation;
    metrics.bestFitness = bestEverFitness;
    metrics.meanFitness = stats.mean;
    metrics.diversity = div;
    const record = { generation, best: stats.best, mean: stats.mean, worst: stats.worst, std: stats.std, diversity: div, bestEver: bestEverFitness };
    history.push(record);
    if (trace) {
      yield makeEvent('generation',
        `Generación ${generation}: mejor ${problem.formatFitness(stats.best)}, media ${problem.formatFitness(stats.mean)}, peor ${problem.formatFitness(stats.worst)}, diversidad ${div.toFixed(3)}.`,
        { ...record, bestIndividual: population[stats.bestIndex], bestEverIndividual: bestEver, population: problem.summarizePopulation ? problem.summarizePopulation(population, fitness) : null },
        metrics);
    }

    if (config.targetFitness !== null && config.targetFitness !== undefined && bestEverFitness >= config.targetFitness - 1e-9) {
      stopReason = `Se alcanzó la aptitud objetivo (${problem.formatFitness(config.targetFitness)}) en la generación ${bestEverGeneration}.`;
      break;
    }
    if (config.stagnation > 0 && generation - bestEverGeneration >= config.stagnation) {
      stopReason = `Estancamiento: ${config.stagnation} generaciones sin mejorar la mejor aptitud.`;
      break;
    }
    if (generation >= config.maxGenerations) {
      stopReason = `Se alcanzó el número máximo de generaciones (${config.maxGenerations}).`;
      break;
    }

    // --- Nueva generación ---
    rankOrder = null;
    const order = fitness.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]).map((e) => e[1]);
    const next = [];
    const nextFitness = [];
    for (let e = 0; e < config.elitism; e++) {
      next.push(population[order[e]]);
      nextFitness.push(fitness[order[e]]);
    }
    let sampledCrossover = false;
    let sampledMutation = false;
    while (next.length < config.populationSize) {
      const i1 = select(stats);
      const i2 = select(stats);
      let children;
      let crossed = false;
      if (rng.next() < config.crossoverRate) {
        const result = problem.crossover(population[i1], population[i2], rng);
        children = result.children;
        crossed = true;
        metrics.crossovers++;
        if (trace && !sampledCrossover) {
          sampledCrossover = true;
          yield makeEvent('crossover', `Cruce representativo (${result.detail}): ${problem.encode(population[i1])} × ${problem.encode(population[i2])} → ${problem.encode(children[0])}.`,
            { parents: [population[i1], population[i2]], children, detail: result.detail }, metrics);
        }
      } else {
        children = [population[i1], population[i2]];
      }
      for (const child of children) {
        if (next.length >= config.populationSize) break;
        const { individual, changes } = problem.mutate(child, config.mutationRate, rng);
        if (changes.length) {
          metrics.mutations++;
          if (trace && !sampledMutation) {
            sampledMutation = true;
            yield makeEvent('mutation', `Mutación representativa (${changes.join(', ')}): ${problem.encode(child)} → ${problem.encode(individual)}.`,
              { before: child, after: individual, changes }, metrics);
          }
        }
        if (!problem.isValid(individual)) {
          throw new Error('El operador genético produjo un individuo no válido; revisa el problema.');
        }
        next.push(individual);
        // Si no hubo cruce ni mutación, el hijo es una copia: se reutiliza la aptitud.
        nextFitness.push(!crossed && changes.length === 0 ? fitness[child === population[i1] ? i1 : i2] : evaluate(individual));
      }
    }
    population = next;
    fitness = nextFitness;
  }

  if (trace) {
    yield makeEvent('stop', `Fin: ${stopReason} Mejor aptitud encontrada: ${problem.formatFitness(bestEverFitness)} (generación ${bestEverGeneration}).`,
      { reason: stopReason, best: bestEver, bestFitness: bestEverFitness }, metrics);
  }
  return {
    best: bestEver,
    bestFitness: bestEverFitness,
    bestGeneration: bestEverGeneration,
    generations: metrics.generation,
    stopReason,
    history,
    metrics: { ...metrics },
    config,
  };
}
