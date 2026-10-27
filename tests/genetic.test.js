import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, geneticAlgorithm, validateConfig } from '../src/algorithms/genetic/engine.js';
import {
  DEFAULT_KNAPSACK, functionProblem, knapsackProblem, randomCities, randomKnapsack, tspProblem,
} from '../src/algorithms/genetic/problems.js';
import { createRng } from '../src/core/rng.js';
import { mean } from '../src/utils/stats.js';
import { run, runCollect } from './helpers.js';

const problems = () => [functionProblem(), knapsackProblem(randomKnapsack(4, { items: 20 })), tspProblem(randomCities(2, 8))];

test('Reproducibilidad: misma semilla, misma evolución; otra semilla, otra evolución', () => {
  for (const problem of problems()) {
    const config = { seed: 9, maxGenerations: 40, populationSize: 30 };
    const a = run(geneticAlgorithm(problem, config, { trace: false }));
    const b = run(geneticAlgorithm(problem, config, { trace: false }));
    assert.deepEqual(a.history, b.history, problem.id);
    assert.deepEqual(a.best, b.best);
    const c = run(geneticAlgorithm(problem, { ...config, seed: 10 }, { trace: false }));
    assert.notDeepEqual(a.history, c.history);
    // Con o sin traza el resultado es el mismo (la traza no consume aleatoriedad).
    const traced = runCollect(geneticAlgorithm(problem, config)).result;
    assert.deepEqual(traced.history, a.history);
  }
});

test('Validez de los individuos y respeto de las restricciones', () => {
  const rng = createRng(3);
  for (const problem of problems()) {
    for (let k = 0; k < 300; k++) {
      const a = problem.randomIndividual(rng);
      const b = problem.randomIndividual(rng);
      assert.ok(problem.isValid(a), problem.id);
      const { children } = problem.crossover(a, b, rng);
      for (const child of children) {
        assert.ok(problem.isValid(child), `${problem.id}: cruce inválido`);
        const { individual } = problem.mutate(child, 0.3, rng);
        assert.ok(problem.isValid(individual), `${problem.id}: mutación inválida`);
      }
    }
  }
  const knap = knapsackProblem(DEFAULT_KNAPSACK);
  const r = run(geneticAlgorithm(knap, { seed: 1, maxGenerations: 30 }, { trace: false }));
  assert.ok(knap.weightOf(r.best) <= knap.capacity, 'la mejor mochila respeta la capacidad');
  // Una permutación con ciudades repetidas no es válida.
  const tsp = tspProblem(randomCities(1, 6));
  assert.equal(tsp.isValid([1, 1, 2, 3, 4]), false);
  assert.equal(tsp.isValid([5, 4, 3, 2, 1]), true);
});

test('Funciones objetivo y soluciones exactas', () => {
  const f = functionProblem({ bits: 22 });
  assert.equal(f.decode(new Array(22).fill(0)), -1);
  assert.equal(f.decode(new Array(22).fill(1)), 2);
  assert.ok(Math.abs(f.f(1.85) - (1.85 * Math.sin(10 * Math.PI * 1.85) + 1)) < 1e-12);
  const ex = f.exact();
  assert.ok(ex.fitness > 2.85 && ex.fitness < 2.851, 'máximo conocido ≈ 2.85027');

  // Mochila: la DP coincide con fuerza bruta en una instancia pequeña.
  const small = knapsackProblem(randomKnapsack(8, { items: 12 }));
  let best = 0;
  for (let mask = 0; mask < 1 << 12; mask++) {
    const ind = Array.from({ length: 12 }, (_, i) => (mask >> i) & 1);
    if (small.weightOf(ind) <= small.capacity) best = Math.max(best, small.valueOf(ind));
  }
  assert.equal(small.exact().fitness, best);
  assert.ok(small.isValid(small.exact().individual));

  // TSP: Held-Karp coincide con fuerza bruta sobre todas las permutaciones (n = 7).
  const tsp = tspProblem(randomCities(5, 7));
  const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
  const brute = Math.min(...perms([1, 2, 3, 4, 5, 6]).map((p) => tsp.tourLength(p)));
  const hk = tsp.exact();
  assert.ok(Math.abs(-hk.fitness - brute) < 1e-9);
  assert.ok(Math.abs(tsp.tourLength(hk.individual) - brute) < 1e-9);
  assert.equal(tspProblem(randomCities(1, 13)).exact(), null, 'sin solución exacta para n > 12');
});

test('Evolución de la población: con elitismo la mejor aptitud nunca empeora y la media mejora', () => {
  for (const problem of problems()) {
    for (const selection of ['tournament', 'roulette', 'rank']) {
      const r = run(geneticAlgorithm(problem, { seed: 4, selection, elitism: 2, maxGenerations: 60 }, { trace: false }));
      for (let g = 1; g < r.history.length; g++) {
        assert.ok(r.history[g].best >= r.history[g - 1].best - 1e-12, `${problem.id} ${selection} gen ${g}`);
      }
      const first = r.history[0].mean;
      const last = mean(r.history.slice(-10).map((h) => h.mean));
      assert.ok(last > first, `${problem.id} ${selection}: la media debería mejorar (${first} → ${last})`);
    }
  }
});

test('Comportamiento estadístico razonable: frente al óptimo exacto en problemas pequeños', () => {
  // No se exige el óptimo en cada ejecución; sí que la media de 10 semillas esté cerca.
  const problem = knapsackProblem(DEFAULT_KNAPSACK);
  const optimum = problem.exact().fitness;
  const results = Array.from({ length: 10 }, (_, i) => run(geneticAlgorithm(problem, { seed: i + 1, maxGenerations: 80 }, { trace: false })).bestFitness);
  assert.ok(results.every((v) => v <= optimum), 'nunca supera el óptimo exacto');
  assert.ok(mean(results) >= 0.95 * optimum, `media ${mean(results)} frente a óptimo ${optimum}`);
  const tsp = tspProblem(randomCities(7, 9));
  const best = -tsp.exact().fitness;
  const lengths = Array.from({ length: 10 }, (_, i) => -run(geneticAlgorithm(tsp, { seed: i + 1, maxGenerations: 100 }, { trace: false })).bestFitness);
  assert.ok(lengths.every((l) => l >= best - 1e-9));
  assert.ok(mean(lengths) <= best * 1.1);
});

test('Criterios de terminación', () => {
  const problem = functionProblem();
  const maxGen = run(geneticAlgorithm(problem, { seed: 1, maxGenerations: 12 }, { trace: false }));
  assert.equal(maxGen.generations, 12);
  assert.match(maxGen.stopReason, /máximo de generaciones/);
  const target = run(geneticAlgorithm(problem, { seed: 1, maxGenerations: 500, targetFitness: 2.0 }, { trace: false }));
  assert.ok(target.bestFitness >= 2.0);
  assert.match(target.stopReason, /objetivo/);
  const stagnation = run(geneticAlgorithm(knapsackProblem(DEFAULT_KNAPSACK), { seed: 1, maxGenerations: 5000, stagnation: 15 }, { trace: false }));
  assert.match(stagnation.stopReason, /Estancamiento/);
  assert.equal(stagnation.generations - stagnation.bestGeneration, 15);
  const { events } = runCollect(geneticAlgorithm(problem, { seed: 1, maxGenerations: 3 }));
  assert.equal(events.at(-1).type, 'stop');
  assert.equal(events.filter((e) => e.type === 'generation').length, 4, 'generaciones 0..3');
});

test('Validación de la configuración', () => {
  assert.equal(validateConfig({ ...DEFAULT_CONFIG }).valid, true);
  assert.equal(validateConfig({ ...DEFAULT_CONFIG, mutationRate: 1.5 }).valid, false);
  assert.equal(validateConfig({ ...DEFAULT_CONFIG, selection: 'magia' }).valid, false);
  assert.equal(validateConfig({ ...DEFAULT_CONFIG, elitism: 60, populationSize: 60 }).valid, false);
  assert.throws(() => run(geneticAlgorithm(functionProblem(), { populationSize: 1 })), /populationSize/);
});
