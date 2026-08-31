# El profesor de guitarra

Vive en `nervcenter.online/musica/` — la sesión es la portada. Todo con
`noindex`: es herramienta suya, no obra publicada.

    index.html       LA SESIÓN: plan del día, calibración, ejercicios, jam, bitácora
    afinador.html    el afinador (nivel 1); también /musica/afinador
    entradas.html    diagnóstico de entradas y salidas de audio
    oido.js          EL OÍDO compartido: YIN + refinado por fase + ataques + worklet
    plan.js          EL CEREBRO: elige del catálogo, escalera de tempo, bitácora
    catalogo.json    43 ejercicios con prerrequisitos. ES el producto.
    prueba-yin.mjs   prueba del oído (importa oido.js: probar el módulo ES probar las páginas)
    prueba-plan.mjs  prueba del plan contra el catálogo real

## Por qué el catálogo es el producto

Si el modelo improvisa el plan de estudio cada sesión, da cosas que suenan bien
y no construyen una sobre otra — y en tres semanas estás igual que con los
videos de YouTube. El catálogo se escribe una vez; `plan.js` sólo **escoge el
siguiente nodo y le ajusta el tamaño**, leyendo la bitácora. El día que el
agente (DeepSeek) entre, entra REEMPLAZANDO a `elegirSesion` con el mismo
contrato — todo lo demás queda igual.

## Las reglas que todo esto da por hechas

1. **Cero notación.** Ningún `dice` menciona pentagrama, tablatura ni figuras.
   Patrones como `A a A a` (abajo/arriba), acordes por nombre.
2. **Nunca "¿qué quieres practicar hoy?"** El plan propone; el botón «proponme
   otro bloque» deja pedir otra cosa. Esa pregunta es la que lo dejaba tocando
   acordes al azar.
3. **La sesión tiene final.** ~12 min: calentamiento (3) + UN bloque del día
   (6) + libre (3). Tres bloques distintos en seis minutos es turismo.
4. **El cierre no se mide.** `lib-jam` hereda la tonalidad del día y es el
   premio.
5. **Todo termina en un número que sube.** La escalera de tempo: aprobado DOS
   días distintos seguidos → +4 bpm (techo +28). Dos veces el mismo día no
   cuenta — sería premiar la racha corta.

## Cómo se corre

- **La sesión completa:** `/musica/`. Propone, calibra si hace falta, corre los
  ejercicios, escribe la bitácora.
- **Un ejercicio suelto:** `/musica/?ej=<id>` — para repetir el que quedó para
  mañana sin esperar a mañana.
- **Las pruebas:** `node prueba-yin.mjs` y `node prueba-plan.mjs`.

## La calibración no es opcional

Toda medida de ritmo incluye la ida y vuelta del sistema (entrada, buffers,
salida). La calibración —10 golpes contra el clic, mediana, se tira lo
inestable— mide ese desfase para restarlo. Sin ella los ejercicios de ritmo
miden a la máquina, no a él. Caduca a los 7 días o al cambiar de interfaz.

## Lo que el motor SÍ mide hoy

`desviacion_ms` (ataques contra el clic, calibrados), `cents`, `tiempo_ms`,
`acierto_pct` (preguntas con teclado), `ninguna` (el jam). Con eso corren los
bloques **calentamiento, púa, ritmo y oído** completos.

## Huecos declarados, no tapados

- **`cambios_por_minuto`, `cuerdas_limpias` y `notas_correctas_pct` no tienen
  motor**: piden oído de acordes/secuencias (nivel 3). Los bloques acordes,
  cambios, power y escala esperan. El plan los enseña como «aún sin motor» con
  el botón **«ya lo sé»** — marca `manual: true`, distinto de medido, y
  desbloquea lo que depende (ritmo entero pide conocer Mi menor).
- **La bitácora vive en localStorage**, por navegador. Pasarla a D1 exige un
  endpoint público nuevo en el worker → cambio de seguridad (regla 7 de la
  casa), con security-review y auditor. Se hará como paso propio, no de paso.
- **El agente LLM no está conectado**: no hay llave de DeepSeek local, y el
  seleccionador determinista cumple el contrato mientras tanto.
- **Los umbrales de `aprobar` son valores de arranque.** Se recalibran en la
  semana 3 con datos reales. Ése es el trabajo, no un pendiente.
- **El catálogo se detiene antes de la cejilla.** A propósito.

## Trampas ya pagadas (ver memoria `audio-en-el-navegador`)

- `getUserMedia` sólo con https/localhost; con `file://` niega siempre.
- Los tres interruptores de Chrome (eco/ruido/AGC) en `false` explícito, y
  **verificar** que quedaron aplicados — el panel lo enseña.
- **Nunca pedir mono** (`channelCount: 1`): Chrome mezcla y la mezcla cancela
  la guitarra en interfaces que duplican con fase invertida (la TEYUN). Se
  analiza canal por canal.
- El refinado de altura es **fase con ventana Blackman, sin filtro** — YIN re-
  corrido sobre ventana filtrada y la fase con Hann ya fallaron y está escrito
  por qué en `oido.js`.
- Para pruebas punta a punta: Edge headless con
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
  --use-file-for-fake-audio-capture=<wav>` — el WAV puede ser estéreo, y la
  ruta va estilo Windows (`C:/...`): con ruta POSIX de Git Bash falla EN
  SILENCIO y todo lee ceros.
