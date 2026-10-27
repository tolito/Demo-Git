# Catálogo de eventos

Formato común:

```js
{
  step,      // número de paso (asignado por el controlador, empieza en 1)
  type,      // tipo de operación (tablas siguientes)
  message,   // explicación en español de lo que se ha hecho
  data,      // estado relevante y elementos afectados
  metrics,   // copia de las métricas acumuladas en ese momento
}
```

## Búsqueda de caminos (`algorithms/pathfinding/search.js`)

| Tipo | Significado | `data` |
|---|---|---|
| `init` | Inicio de la búsqueda | `start`, `goal` |
| `discover` | Celda añadida por primera vez a la frontera | `index`, `g`, `h`, `f`, `parent` |
| `repush` | (DFS) celda apilada de nuevo desde otro vecino | `index`, `parent` |
| `update` | (Dijkstra/A\*) se encontró un camino más barato a una celda de la frontera | `index`, `g`, `h`, `f`, `parent` |
| `expand` | Celda extraída de la frontera y procesada | `index`, `g`, `f` |
| `skip` | Entrada obsoleta descartada (celda ya cerrada o con g peor) | `index` |
| `goal` | Se extrajo el destino | `index` |
| `path` | Camino reconstruido desde los predecesores | `path` |
| `no-path` | No existe camino | — |

Métricas: `expanded`, `discovered`, `pushes`, `pops`, `edgeChecks`, `relaxations`, `staleSkips`, `frontierSize`, `frontierPeak`, `memoryPeak`.

## Backtracking (`algorithms/backtracking/engine.js`)

| Tipo | Significado | `data` |
|---|---|---|
| `start` | Inicio | `variables` |
| `select-variable` | Variable elegida (orden fijo o MRV) | `variable`, `candidates`, `depth` |
| `try-candidate` | Se elige un candidato | `variable`, `value` |
| `check` | El candidato cumple las restricciones | `variable`, `value` |
| `conflict` | El candidato viola una restricción | `variable`, `value`, `conflicts` (variables implicadas) |
| `assign` | Asignación | `variable`, `value`, `depth` |
| `advance` | Se pasa al siguiente nivel | `depth` |
| `backtrack` | Se deshace una asignación | `variable`, `value`, `depth` |
| `dead-end` | No quedan candidatos para la variable | `variable` |
| `bound-prune` | (optimize) poda por cota inferior | `bound`, `bestCost` |
| `solution` | Asignación completa | `assignment` (y `cost`, `improved` en optimize) |
| `finished` | Fin de la búsqueda | `complete`, `solutions` |

Métricas: `nodes`, `checks`, `conflicts`, `backtracks`, `deadEnds`, `boundPrunes`, `solutions`, `depth`, `maxDepth`.

## CSP (`algorithms/csp/solver.js`)

| Tipo | Significado | `data` |
|---|---|---|
| `start` | Inicio | — |
| `ac3-start` / `ac3-end` | Inicio / fin de una pasada de AC-3 | `arcs`, `phase` |
| `ac3-revise` | Un arco eliminó valores sin soporte | `variable`, `against`, `removed` |
| `domain-wipeout` | Un dominio se quedó vacío | `variable` |
| `select-variable` | Variable elegida | `variable`, `remaining`, `degree` |
| `order-values` | Orden LCV de los valores | `variable`, `order` (`value`, `eliminated`) |
| `try-value` | Se prueba un valor | `variable`, `value` |
| `conflict` | El valor viola una restricción | `variable`, `value`, `constraint`, `with` |
| `assign` | Asignación | `variable`, `value`, `depth` |
| `prune` | Forward checking eliminó valores | `variable`, `removed`, `cause` |
| `restrict` | MAC reduce el dominio de la variable asignada a su valor | `variable`, `removed` |
| `restore` | Se restauran valores eliminados por la inferencia | `restored` (pares variable/valor) |
| `backtrack` | Se deshace una asignación | `variable`, `value` |
| `dead-end` | No quedan valores | `variable` |
| `solution` | Solución completa | `assignment` |
| `finished` | Fin | `solutions` |

Métricas: `nodes`, `checks`, `conflicts`, `backtracks`, `prunes`, `revisions`, `arcsProcessed`, `wipeouts`, `solutions`.

## Minimax y alfa-beta (`algorithms/game-theory/search.js`)

| Tipo | Significado | `data` |
|---|---|---|
| `enter` | Se visita un nodo | `id`, `parentId`, `move`, `moveLabel`, `depth`, `isMax`, `alpha`, `beta`, `state` |
| `leaf` | Hoja evaluada | `id`, `value`, `exact` (terminal) o heurística |
| `update` | El nodo recibe el valor de un hijo | `id`, `childId`, `value`, `alpha`, `beta`, `bestMove`, `improves` |
| `prune` | Poda: α ≥ β | `id`, `prunedMoves`, `prunedLabels`, `alpha`, `beta`, `bound` |
| `exit` | El nodo devuelve su valor | `id`, `value`, `bestMove`, `exact`, `bound` |
| `choose` | Jugada elegida en la raíz | `id`, `bestMove`, `value`, `exact` |

Métricas: `visited`, `leaves`, `terminalLeaves`, `heuristicLeaves`, `cutoffs`, `prunedBranches`, `maxDepth`.

## Algoritmo genético (`algorithms/genetic/engine.js`)

| Tipo | Significado | `data` |
|---|---|---|
| `generation` | Resumen de la generación evaluada | `generation`, `best`, `mean`, `worst`, `std`, `diversity`, `bestEver`, `bestIndividual`, `bestEverIndividual`, `population` (resumen, si el problema lo define) |
| `crossover` | Primer cruce de la generación (representativo) | `parents`, `children`, `detail` |
| `mutation` | Primera mutación de la generación (representativa) | `before`, `after`, `changes` |
| `stop` | Fin y motivo | `reason`, `best`, `bestFitness` |

Métricas: `generation`, `evaluations`, `crossovers`, `mutations`, `bestFitness`, `meanFitness`, `diversity`.
