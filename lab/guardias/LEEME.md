# Los instrumentos de la cara v4

Trece scripts que **miden** la portada en vez de mirarla. Se escribieron
construyendo `v4.html` y cada uno nació de un defecto que no se veía a simple
vista. Viven en `lab/`, que el middleware bloquea en producción
(`functions/_middleware.js`, lista `TALLER`), así que están versionados y no se
sirven.

**Node 22 trae `WebSocket` global**, así que todos hablan CDP contra Edge
headless **sin una sola dependencia npm**. No hay que instalar nada.

    node lab/guardias/<script>.mjs <url>

Para servir el sitio local: `preview_start` con `nerv-estatico`
(`.claude/launch.json`, puerto 8790).

## Qué mide cada uno

| script | qué contesta | por qué existe |
|---|---|---|
| `col.mjs` | ¿alguna coordenada de telemetría pisa texto? A 1600/1280/900/390 | Se sembraban al azar y caían sobre el titular. **Respeta `visibility`** — un elemento oculto sigue teniendo rectángulo, y sin eso el propio medidor mentía |
| `salto.mjs` | ¿la página se mueve al girar el titular? Alto del h1, Y de la demo y alto de página por palabra, en los dos idiomas | El bug que Daniel vio: en español «portafolios» subía todo 61px |
| `desb.mjs` | ¿desborda alguna palabra? Las 6 a 5 anchos, en ambos idiomas | El titular giratorio cambia de ancho |
| `contraste.mjs` | pares bajo 4.5:1, separando la **columna de lectura** (≥12px) del resto | La línea base de la casa. Mata las transiciones antes de medir (regla 9) |
| `tipo.mjs` | cuántos tamaños, pesos y familias hay de verdad | Destapó 16 tamaños y 5 pesos donde la doctrina pide tres y dos |
| `mirar.mjs` | captura la página **después de recorrerla**, y con `--sin-mov` la captura sin el motor de animación | La prueba de la regla 3: sin JS la página tiene que verse igual. Reporta cuántos elementos quedaron sin revelar |
| `dx.mjs` | errores y excepciones de consola, y qué hijos del `body` ocupan alto | Cazó los 900px que `#dc-root` seguía ocupando vacío |
| `reel4.mjs` | los 4 carretes: proporción, diferencia escenario/video, y **cuántos videos quedan varados** tras cerrar | Los videos se apilaban en el escenario en vez de volver a su tarjeta |
| `es-check.mjs` | ¿se aplicó el español? Qué cadenas siguen en inglés | El diccionario estaba bien y no se disparaba nunca |
| `gira.mjs` | el carrusel: gira, índice, pausa, botones, en ambos idiomas | — |
| `limite.mjs` | **coste en ms** de re-sembrar la ráfaga, viaje del riel, medida real | Había que probar que redibujar cada 2.6s no da tirón (34ms el primero, 5-11 los demás) |
| `textos.mjs` | vuelca los nodos de texto reales del DOM | Para generar el diccionario ES con las claves **exactas**, no inventadas |
| `archivar.mjs` | capturas de página completa en varios estados (idioma × modo, escritorio y móvil) | El respaldo visual de `nerv-v3` |

## La lección que los explica a todos

**Cada defecto de esta portada se encontró midiendo, no mirando** — y varios los
había metido yo:

- La regla de apilamiento le ganaba en especificidad al `position:absolute` del
  alambre y abría 210px de hueco.
- El riel era hijo de la lista, así que `!lista.childNodes.length` daba los
  botones por construidos y nunca se creaban.
- `armar()` usa `data-carrete` como marca de «ya montada»; ponerlo a mano en el
  marcado hacía que el carrete no creara el video ni definiera `_volver()`.
- El módulo de idioma esperaba a `.topbar`, que era del componente retirado.

Ninguno se veía en una captura. Todos salieron en un número.
