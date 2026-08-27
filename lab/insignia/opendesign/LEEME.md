# La insignia, en formato OpenDesign

Los mismos tres archivos que están instalados en

    %APPDATA%\Open Design\namespaces\release-stable-win\data\design-systems\insignia\

Se copian aquí porque esa carpeta **no es un repo** y porque esto es una
traducción de `lab/insignia/`: cuando la gramática cambie, cambian los dos.

| archivo | qué es |
|---|---|
| `manifest.json` | Metadatos v1 (`od-design-system-project/v1`). El slug y `manifest.id` deben coincidir. |
| `DESIGN.md` | La doctrina en su estructura de 10 secciones. Es lo que el agente lee en cada render. |
| `tokens.css` | Las 56 fichas obligatorias del esquema más 9 extensiones propias. |

## Restaurar

Copiar la carpeta entera a la ruta de arriba. El daemon la descubre sola —
escanea en cada petición a `/api/design-systems`, no hace falta reiniciarlo.

Se instaló en `Roaming` y **no** en `Programs\Open Design\resources\`: esa
segunda se borra en cada actualización de la app.

## Qué NO viaja aquí

La implementación. El vocabulario de verdad —las ~40 clases y los 9
generadores— vive en `lab/insignia/insignia.css` y `insignia.js`, que ya están
en este repo. El formato de OpenDesign sólo tiene ranuras para prosa y fichas,
así que su agente lee la descripción de la ráfaga pero no tiene el canvas que
la dibuja.
