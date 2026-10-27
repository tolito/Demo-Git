# Arquitectura

## Capas y dependencias

```
ui/ (DOM, laboratorios)  ──►  visualization/ (modelos sin DOM + renderizadores Canvas/SVG)
   │                                   │
   └──────────────►  experiments/  ──► algorithms/  ──►  core/  ◄── utils/
```

- `core/` y `algorithms/` no usan el DOM: se ejecutan igual en Node (pruebas) y en el navegador.
- `visualization/models.js` tampoco usa el DOM; los renderizadores (`grid-renderer.js`, `tree-renderer.js`, `charts.js`) sí.
- No hay dependencias circulares (se comprobó con un análisis del grafo de imports).

## Algoritmos como generadores

Cada algoritmo es una función generadora. Cada `yield` entrega un evento que describe una operación **que acaba de ocurrir**; el `return` entrega el resultado final. Con `trace: false` el algoritmo no crea eventos (se usa para medir tiempos y en experimentos), y las pruebas comprueban que el resultado y las métricas son idénticos con y sin traza.

Ventajas de este diseño:
- La visualización no simula nada: el controlador avanza el algoritmo real un evento cada vez.
- El mismo código sirve para la ejecución paso a paso, para los comparadores, los experimentos y las pruebas.
- Cancelar es cerrar el generador (`generator.return()`), que ejecuta sus bloques `finally`.

## Controlador de ejecución (`core/execution-controller.js`)

Estado: generador, historial de eventos, posición del cursor, estado visual actual y puntos de control.

- **Avanzar**: si el cursor está dentro del historial, reaplica el evento guardado; si no, extrae el siguiente evento del generador (ejecución perezosa).
- **Retroceder / saltar**: restaura el último punto de control ≤ objetivo (clonado) y reaplica los eventos intermedios. Coste O(intervalo) por salto, memoria O(eventos / intervalo × tamaño del estado). El intervalo se ajusta por laboratorio (p. ej. en caminos, proporcional al tamaño del mapa).
- **Reproducción**: un temporizador aplica uno o varios eventos por tick según la velocidad (mínimo 16 ms entre ticks).
- **Hasta el final**: bloques limitados por tiempo (~14 ms) separados por `setTimeout(0)` para no bloquear la interfaz.
- **Detener**: cancela temporizadores y cierra el generador; el historial sigue navegable. **Reiniciar** crea un generador nuevo. **dispose** deja el controlador sin temporizadores ni escuchadores (se llama al cambiar de laboratorio).
- **Límite de eventos**: más allá de `maxEvents` los eventos se aplican pero no se guardan; a partir de ahí se desactiva el retroceso (no se podrían reproducir para volver al final).
- **Errores**: una excepción del algoritmo o del modelo pasa el estado a `error`, se muestra al usuario y se cierra el generador.
- El planificador (`setTimeout`, `clearTimeout`, `now`) es inyectable; las pruebas usan uno falso y determinista.

## Modelos de visualización

`{ init(), apply(state, event), clone(state) }`. `apply` debe ser determinista y depender solo del estado y del evento. Las pruebas verifican, para los seis modelos, que el estado obtenido retrocediendo con puntos de control es idéntico al obtenido reproduciendo desde el principio.

## Interfaz

- `ui/app.js`: navegación por hash (`#/pathfinding`, `#/csp`...), tema claro/oscuro (preferencia del sistema o elección guardada) y ciclo de vida de los laboratorios (`mount` devuelve una función de limpieza).
- `ui/components/run-session.js`: controles, métricas, registro virtualizado (solo se dibujan las filas visibles, por lo que admite cientos de miles de eventos) e inspector del paso. El redibujado se limita a una vez por fotograma.
- `ui/components/lab-layout.js`: estructura común, leyendas, tablas y pestañas.
- La cuadrícula usa Canvas (decenas de miles de celdas por fotograma); árboles, grafos y gráficos usan SVG.

## Decisiones no evidentes

- **Sin Web Workers**: los generadores troceados ya evitan bloquear la interfaz durante la visualización, y un Worker obligaría a serializar estado y eventos. Las operaciones síncronas largas que quedan están acotadas y documentadas en el README.
- **DFS** con pila que admite entradas repetidas: es el orden DFS real; las entradas obsoletas se descartan y se registran (`skip`), en vez de ocultar ese trabajo.
- **Dijkstra/A\*** con eliminación perezosa en lugar de *decrease-key*: más simple con un montículo binario; las extracciones obsoletas se cuentan (`staleSkips`).
- **Desempates deterministas** (orden de inserción en la cola de prioridad, orden fijo de vecinos) para que las trazas sean reproducibles.
- **Generador aleatorio propio con semilla** en lugar de `Math.random`, para que mapas, Sudokus, árboles y AG sean reproducibles en cualquier entorno.
