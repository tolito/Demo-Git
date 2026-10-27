# Algorithm Lab

Laboratorio interactivo, en español, para **ejecutar, visualizar y comparar algoritmos reales** paso a paso: búsqueda de caminos, backtracking, satisfacción de restricciones (CSP), teoría de juegos y algoritmos genéticos, más una sección de experimentos reproducibles.

Todo es HTML5 + CSS3 + JavaScript nativo con módulos ES. **No hay dependencias** (ni de ejecución ni de desarrollo), ni backend, ni servicios externos.

---

## 1. Instalación y ejecución

Requisitos: un navegador moderno (Chrome, Edge o Firefox recientes) y, para el servidor incluido y las pruebas, **Node.js 18 o superior** (desarrollado y probado con Node 22).

Los módulos ES no se cargan abriendo `index.html` con doble clic (`file://`): hay que servir la carpeta por HTTP. Cualquiera de estas opciones sirve:

```bash
# Opción 1: servidor estático incluido (sin dependencias)
npm start                 # http://127.0.0.1:8080/
node scripts/serve.mjs 3000   # otro puerto

# Opción 2: Python, si está instalado
python -m http.server 8080
```

En **Windows** los mismos comandos funcionan en PowerShell o CMD (`npm start` o `node scripts\serve.mjs`). Después, abre `http://127.0.0.1:8080/` en el navegador.

No hace falta `npm install`: el proyecto no tiene paquetes que instalar.

## 2. Pruebas automatizadas

```bash
npm test          # equivale a: node --test
```

Usa el ejecutor de pruebas integrado en Node (`node:test`), que localiza los ficheros `tests/*.test.js`. La batería completa (68 pruebas) tarda unos 30 s; la mayor parte es la verificación del árbol completo del tres en raya (549 946 nodos) y la equivalencia minimax/alfa-beta en cientos de posiciones.

Qué se comprueba (resumen; detalle en cada fichero):

| Fichero | Contenido |
|---|---|
| `tests/core.test.js` | RNG con semilla, cola de prioridad, controlador de ejecución: avance perezoso, retroceso con puntos de control, reproducción con temporizador, pausa, velocidad, ejecución por bloques, detención (cierra el generador y no deja temporizadores), reinicio, límite de eventos, errores, `dispose`. |
| `tests/pathfinding.test.js` | Ruta directa, bloqueada, origen = destino, obstáculos, costes distintos, **comparación de Dijkstra y A\* con una referencia independiente (Bellman-Ford)** en 50 mapas aleatorios, admisibilidad de heurísticas frente al coste real restante, diagonales sin cortar esquinas, reconstrucción del camino, coherencia métricas/eventos. |
| `tests/backtracking.test.js` | Sudoku resuelto, inválido, sin solución y con soluciones múltiples (contadas exactamente); generador con unicidad verificada; N reinas n = 1..9 contra OEIS A000170; secuencia de eventos y deshacer; asignación de tareas contra fuerza bruta. |
| `tests/csp.test.js` | CSP consistente e inconsistente, mismo número de soluciones con todas las combinaciones de heurísticas, corrección de forward checking reproduciendo eventos, arco-consistencia real tras AC-3 sin perder soluciones, Sudoku-CSP = Sudoku-backtracking, restricciones n-arias, límite de nodos. |
| `tests/games.test.js` | Estados terminales, victorias/derrotas/empates, movimientos y estados ilegales, árbol completo (549 946 nodos, 255 168 partidas, valor 0), equivalencia minimax/alfa-beta con 4 órdenes y 2 profundidades, validez de la poda, mejor caso con orden oráculo, valores heurísticos marcados. |
| `tests/genetic.test.js` | Reproducibilidad por semilla, validez de individuos tras cruce y mutación, restricciones, soluciones exactas contra fuerza bruta, mejora de la población, comportamiento estadístico (media de 10 semillas cerca del óptimo, nunca por encima), criterios de parada, validación de la configuración. |
| `tests/models-experiments.test.js` | Para los 6 modelos de visualización: retroceder con puntos de control produce exactamente el mismo estado que reproducir desde cero. Estadística, exportación CSV/JSON, validación de parámetros, reproducibilidad de los 5 experimentos y cancelación. |

## 3. Estructura del proyecto

```
index.html                      Página única
styles/main.css                 Estilos, tokens de color, modo oscuro, responsive
scripts/serve.mjs               Servidor estático sin dependencias
src/core/                       Núcleo independiente del DOM
  rng.js                        Generador pseudoaleatorio con semilla (mulberry32)
  priority-queue.js             Montículo binario con desempate estable
  trace.js                      Formato de eventos y ejecución sin visualización
  execution-controller.js       Motor de ejecución paso a paso (avance, retroceso...)
src/algorithms/                 Algoritmos (sin DOM)
  pathfinding/                  grid.js, heuristics.js, search.js (BFS, DFS, Dijkstra, A*), maps.js
  backtracking/                 engine.js (motor genérico), sudoku.js, nqueens.js, task-assignment.js
  csp/                          csp.js (modelo), solver.js (búsqueda, MRV, grado, LCV, FC, AC-3, MAC), problems.js
  game-theory/                  tictactoe.js, synthetic-tree.js, search.js (minimax y alfa-beta)
  genetic/                      engine.js (motor), problems.js (función, mochila, TSP + soluciones exactas)
src/experiments/                definitions.js (experimentos) y runner.js (ejecución y agregación)
src/visualization/              models.js (eventos → estado visual, sin DOM),
                                grid-renderer.js (Canvas), tree-renderer.js y charts.js (SVG)
src/ui/                         app.js (navegación y tema), dom.js, components/, labs/ (un módulo por laboratorio)
src/utils/                      stats.js, export.js, format.js, storage.js
tests/                          Pruebas con node:test
docs/                           architecture.md y events.md
```

El fichero `README` ya existía en el repositorio y no se ha modificado.

## 4. Uso

La página de inicio enlaza seis laboratorios. Cada uno tiene: parámetros (izquierda), área visual, controles de ejecución y métricas en tiempo real (derecha), registro de operaciones navegable con inspector del paso, explicación breve y ayuda contextual plegable, ejemplos precargados y botón de reinicio.

**Controles de ejecución** (comunes): Iniciar/Reanudar, Pausar, retroceder un paso, avanzar un paso, Hasta el final, Detener, Reiniciar, velocidad (1–5000 pasos/s, escala logarítmica) y una barra para saltar a cualquier paso registrado. En el registro, un clic sobre un paso lleva a ese estado. Teclado (fuera de campos de texto): **Espacio** inicia/pausa, **←/→** retroceden/avanzan. En el mapa de caminos, con el foco en el lienzo, las flechas mueven un cursor y Espacio/Intro aplica la herramienta.

La ejecución se prepara automáticamente al cambiar parámetros o el problema, por lo que basta con pulsar ▶.

## 5. Algoritmos, supuestos y complejidad

V = celdas transitables, E = aristas (≤ 4V u 8V), b = ramificación, m = profundidad, d = tamaño de dominio, n = variables.

### Búsqueda de caminos

Reglas (comunes a todos):
- Ortogonal: 4 vecinos, paso de longitud 1. Diagonal: 8 vecinos, paso diagonal de longitud √2.
- **No se cortan esquinas**: un paso diagonal solo es legal si las dos celdas ortogonales adyacentes están libres.
- Coste de un movimiento = coste de la celda de destino (entero ≥ 1: 1, 3, 5 o 9) × longitud del paso.
- El coste del resultado se **recalcula a partir del camino** (`measurePath`), que además valida cada paso. Longitud geométrica, número de movimientos, coste, nodos expandidos/descubiertos y tiempo se informan por separado.

| Algoritmo | Garantía | Tiempo | Espacio |
|---|---|---|---|
| BFS (cola FIFO) | Mínimo número de movimientos. Óptimo en coste solo si todos los movimientos cuestan igual (ortogonal y coste uniforme); si no, se indica. | O(V + E) | O(V) |
| DFS (pila explícita; una celda puede apilarse varias veces y las entradas obsoletas se descartan) | Encuentra una ruta si existe; **sin garantía de optimalidad**. | O(V + E) | O(V + E) en el peor caso por las entradas repetidas |
| Dijkstra (montículo binario con eliminación perezosa) | Óptimo con costes no negativos. | O((V + E) log V) | O(V + E) |
| A* (f = g + h, desempate por menor h) | Óptimo si h es admisible y consistente; no reabre nodos cerrados. | Peor caso como Dijkstra; en la práctica depende de h | O(V + E) |

Heurísticas de A* (todas multiplicadas por el coste mínimo de celda del mapa): Manhattan (admisible solo en ortogonal), Octil, Euclídea, Chebyshev (admisibles en ambos movimientos) y nula. La interfaz avisa cuando la combinación elegida no es admisible.

La «memoria estimada» es el pico de entradas simultáneas en frontera + tabla de predecesores: un recuento de entradas, no bytes.

### Backtracking (motor genérico)

`backtrackingSearch(problem, options)` con modos `first`, `all` (con límite) y `optimize` (ramificación y poda con cota inferior). Selección de variable estática o MRV (las comprobaciones que hace MRV se cuentan). Peor caso O(dⁿ) en tiempo y O(n) de profundidad de pila.

- **Sudoku**: variables = celdas vacías, valores 1–9, máscaras de bits por fila/columna/caja. Validación de pistas, resolución paso a paso, recuento de soluciones (para la unicidad basta contar hasta 2) y generador: rellena un tablero con valores barajados por semilla y quita pistas solo si la búsqueda exhaustiva sigue encontrando exactamente una solución. Un tablero solo se etiqueta «único» tras esa comprobación.
- **N reinas**: variable = fila, valor = columna; n de 1 a 20. Detecta tamaños sin solución (n = 2, 3) mediante búsqueda exhaustiva; los recuentos se comparan con OEIS A000170. Se puede detener en cualquier momento.
- **Asignación de tareas** (minimizar coste): restricciones de habilidad, capacidad por agente e incompatibilidad entre tareas. Estrategia simple (orden fijo, sin poda) frente a mejorada (MRV + candidatos por coste creciente + poda por cota optimista). Ambas son exactas; la interfaz y las pruebas comprueban que obtienen el mismo coste.

### CSP

Modelo con variables, dominios y restricciones binarias (con predicado explícito, propagables por AC-3) o n-arias (predicado sobre la asignación parcial). Resolución por búsqueda con:
- **MRV** (sin inferencia, cuenta valores legales; con inferencia, tamaño del dominio), **grado** como desempate (o criterio único) y **LCV**.
- **Forward checking**: tras asignar, elimina de las variables libres de cada restricción los valores que ya la violan (sirve también para n-arias). O(e·d) por asignación.
- **AC-3**: preprocesado opcional y **MAC** (AC-3 tras cada asignación, partiendo de los arcos de todas las variables cuyo dominio cambió). O(e·d³).
- AC-3 **no resuelve por sí solo** el CSP: puede probar inconsistencia (dominio vacío), pero un problema arco-consistente puede no tener solución (K4 con 3 colores, incluido como ejemplo). Las restricciones n-arias no se propagan con AC-3.
- Se detectan inconsistencias antes de buscar, se agotan búsquedas sin solución y hay límite de nodos opcional.

Problemas: coloreado (Australia, K4, grafos aleatorios por semilla), Sudoku como CSP (81 variables, 810 restricciones ≠) y asignación de tareas (dominios filtrados por habilidad, ≠ por incompatibilidad, = para tareas que van juntas, capacidad n-aria), con una variante sin solución.

### Teoría de juegos

Minimax y alfa-beta sobre una interfaz de juego genérica (`legalMoves`, `applyMove`, `isTerminal`, `utility`, `evaluate`...). Profundidad y orden de jugadas configurables (natural, inverso, aleatorio con semilla, heurístico en el tres en raya, oráculo en árboles sintéticos). Minimax: O(bᵐ) tiempo, O(b·m) espacio; alfa-beta: O(bᵐᐟ²) en el mejor caso.

- **Tres en raya**: X = MAX. Estados validados (recuento de fichas, turno, no pueden ganar ambos, nadie juega tras ganar). Utilidad terminal exacta ±(100 − fichas) o 0; evaluación heurística por líneas abiertas (|h| ≤ 24) usada solo al cortar por profundidad, y marcada con `*`. Se puede jugar contra la IA.
- **Árbol sintético**: ramificación 2–5, profundidad 1–7, hojas aleatorias con semilla o introducidas a mano; incluye el ejemplo clásico de Russell y Norvig.
- Visualización: valores, α y β por nodo, ramas podadas (✂), cotas «≥/≤» en nodos con poda, jugada elegida, contadores de nodos visitados y podados. «Comparar» ejecuta ambos algoritmos sobre el mismo estado y verifica que el valor coincide y que la jugada de alfa-beta tiene el valor minimax óptimo (pueden diferir entre jugadas empatadas).

### Algoritmos genéticos

Motor genérico con población, generaciones, probabilidad de mutación y de cruce, selección (torneo, ruleta con desplazamiento, rango lineal), elitismo, semilla, parada por número de generaciones, estancamiento u objetivo (opcionalmente el óptimo exacto). Coste O(G·N·(f + L)) más O(G·40²·L) para la diversidad.

| Problema | Objetivo y restricciones | Representación y operadores | Referencia exacta |
|---|---|---|---|
| Función | Maximizar f(x) = x·sin(10πx) + 1, x ∈ [−1, 2] | 22 bits → x lineal (dominio garantizado); cruce de un punto; mutación bit a bit | Búsqueda exhaustiva de las 2²² codificaciones |
| Mochila 0/1 | Maximizar valor con peso ≤ capacidad | Binaria; cruce de un punto; mutación bit a bit; **reparación** determinista (quita el peor valor/peso) | Programación dinámica O(n·W) |
| Viajante (TSP) | Minimizar la longitud del ciclo (aptitud = −longitud) | Permutación con origen fijo; cruce OX; mutación por inversión | Held-Karp O(n²·2ⁿ), solo n ≤ 12 |

Un AG **no garantiza** el óptimo global; la interfaz muestra la distancia al óptimo exacto y las pruebas solo exigen propiedades y resultados estadísticos.

### Experimentos

Cinco experimentos: caminos en mapas aleatorios, Sudoku (orden fijo vs. MRV), heurísticas CSP en coloreado, minimax vs. alfa-beta en árboles sintéticos y variabilidad del AG entre semillas (con comparación de métodos de selección). La repetición i usa la semilla `semilla + i` y **todas las variantes de una repetición comparten instancia**, de modo que los tiempos se comparan sobre la misma carga. Se muestran resultados individuales y, por separado, las estadísticas agregadas (n, media, desviación típica muestral, mín., máx., mediana), un gráfico de barras con error, exportación a CSV/JSON y configuraciones guardadas en `localStorage`.

## 6. Cómo añadir un algoritmo o un laboratorio

1. **Algoritmo**: escribe una función generadora en `src/algorithms/...` que reciba el problema y `options` (con `trace`), emita eventos con `makeEvent(type, mensaje, datos, métricas)` solo si `trace` es verdadero, y devuelva el resultado con `return`. No uses el DOM.
2. **Registro**: añádela al registro del módulo (`PATHFINDING_ALGORITHMS`, `CSP_PRESETS`, `TASK_STRATEGIES`, `GENETIC_PROBLEMS`...). Los laboratorios construyen sus selectores a partir de esos registros: un nuevo algoritmo de caminos aparece automáticamente en el selector, en el comparador y en el experimento.
3. **Visualización**: si emite tipos de evento nuevos, trátalos en el modelo correspondiente de `src/visualization/models.js` (`apply` debe ser determinista; `clone` debe copiar todo lo mutable).
4. **Laboratorio nuevo**: crea `src/ui/labs/mi-lab.js` exportando `{ id, title, summary, mount(container) }`, donde `mount` devuelve una función de limpieza, y añádelo a `src/ui/labs/index.js`. `createLabLayout` y `createRunPanel` dan la estructura y los controles comunes.
5. Añade pruebas en `tests/`. La prueba genérica de `models-experiments.test.js` muestra cómo verificar que retroceder reproduce el estado exacto.

Más detalle en [`docs/architecture.md`](docs/architecture.md) y el catálogo de eventos en [`docs/events.md`](docs/events.md).

## 7. Limitaciones conocidas

- **Verificación**: las pruebas automáticas se ejecutaron con Node 22 en Linux, y la interfaz se comprobó con Chromium (Playwright) en Linux: navegación por los seis laboratorios, ejecución, retroceso, detención, teclado, modo oscuro y ancho de móvil (390 px) sin errores de consola. **No se ha probado en un Windows real ni en Firefox o Safari**; el código no usa nada específico de plataforma, pero esa comprobación queda pendiente. Tampoco se ha auditado con un lector de pantalla.
- **Sin Web Workers**: los algoritmos visualizados avanzan por bloques de ~14 ms y la interfaz no se bloquea. Algunas acciones puntuales sí son síncronas y pueden congelar la página unos instantes: comparar minimax y alfa-beta desde el tablero vacío (1–2 s según el equipo: 549 946 nodos más el cálculo del valor de cada jugada), la comparación CSP en Sudoku (limitada a 100 000 nodos por configuración) o experimentos grandes entre repetición y repetición.
- **Límites de almacenamiento**: el registro guarda como máximo 200 000–300 000 eventos según el laboratorio. Si se supera, la ejecución continúa y la vista se actualiza, pero ya no se puede retroceder (se avisa en pantalla). El árbol de juego dibuja como máximo 1500 nodos; el resto se cuenta pero no se dibuja.
- **A\*** no reabre nodos cerrados: es correcto con heurísticas consistentes (todas las admisibles incluidas lo son con estas reglas). Con Manhattan y diagonales (no admisible) el resultado puede no ser óptimo, y así se indica.
- **Tiempos** medidos con `performance.now()` en el navegador: son orientativos, dependen del equipo y su resolución puede estar limitada por el navegador. La memoria es una estimación en número de entradas, no una medición.
- **AC-3** solo propaga restricciones binarias; las n-arias (capacidad) solo se comprueban y se tratan con forward checking.
- **Sudoku sin heurísticas**: el backtracking básico con orden fijo puede necesitar millones de nodos en tableros difíciles; se recomienda MRV para el ejemplo «Difícil».
- **AG**: la referencia exacta del TSP solo se calcula hasta 12 ciudades. La diversidad se calcula sobre los 40 primeros individuos.
- La explicación de cada evento describe la operación realizada y los valores evaluados en ese momento; no intenta justificar decisiones que el algoritmo no evaluó.
