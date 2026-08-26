# nerv — portfolio + agente

Portfolio en `index.html` (Cloudflare Pages → https://nervcenter.online) y el
agente del chat en `agente/` (Cloudflare Worker `daniel-agente`). Todo estático
en la raíz, sin build.

## Reglas de la casa (no negociables)

1. **Todo lo nuestro va FUERA del bloque `<x-dc>`.** Una sincronización desde
   Claude Design regenera el componente y borra lo que esté adentro. El árbol
   vivo del componente es `#dc-root` (la etiqueta `<x-dc>` es sólo la semilla) —
   los anexos se montan tras `#dc-root`, no tras la etiqueta.
2. **El componente se repinta solo.** Todo lo que se cuelgue del DOM debe ser
   idempotente y re-aplicarse con un MutationObserver colgado del `<body>`
   (nunca de una sección: muere con ella).
3. **Nada invisible esperando animación.** Todo revelado necesita una salida al
   estado final que no dependa del frame loop.
4. **`piel.js` va versionado** (`piel.js?v=N`). Al tocarlo, subir la versión en
   las CUATRO páginas que lo cargan. La piel es opcional, el chat no: toda
   llamada a piel/bloques va en try con respaldo.
5. **El agente cambia fichas, no marcado.** Nunca HTML/CSS libre hacia el DOM.
   Nivel 4 (HTML libre) sólo dentro de iframe con sandbox + CSP.
6. **Las pieles viven en la sesión de quien las pidió.** No se persisten al
   servidor — un troll arruinaría el sitio para todos.
7. **Cualquier cambio de tono/prompt/herramientas del agente público es un
   cambio de SEGURIDAD.** Antes de darlo por bueno: correr la batería del
   subagente `auditor-rojo`. Ya pasó una vez que "hazlo más comercial" terminó
   con el agente escribiendo código gratis a desconocidos.
8. **El agente corre sobre DeepSeek** vía su endpoint compatible con Anthropic
   (`api.deepseek.com/anthropic`). El `import Anthropic from '@anthropic-ai/sdk'`
   es correcto — NO "arreglarlo". Ids de modelo vigentes: verificarlos en
   api-docs.deepseek.com antes de escribir código.
9. **El Browser pane no compone**: rAF, IntersectionObserver y transiciones no
   corren, y `getComputedStyle` devuelve el valor de salida durante una
   transición. Para medir colores: matar las transiciones a la fuerza primero.
10. **Contraste con línea base medida** (`.claude/guardias/contraste.js`, en la
    consola del navegador → `nervContrasteEstados()`):

        claro original ....... 41 bajo 4.5:1   (6 de lectura)
        modo oscuro .......... 34              (6)
        morado sobre claro ... 41   <- idéntico a su base
        cian sobre oscuro .... 34   <- idéntico a su base

    **Lo que se protege no es el número, es la última columna:** una piel
    derivada debe dar EXACTAMENTE el mismo conteo que su modo base. Si da más,
    se rompió el motor de luminancia — ése es el hallazgo. Auditar TODOS los
    pares reales de color, no sólo tinta/papel.

    **La columna de lectura vale más que el total.** Las 6 son siempre las
    mismas y ninguna es texto de leer ("ADRIFT" 360/380px, "001/002/003" 132px,
    "02" 460px). Hoy no hay ni una falla real. Si sube de 6, es hallazgo.

    Números muertos: el `49/33` traía tres falsos positivos de contacto (el
    barrido no leía degradados); el `17/11` es de una regla más vieja.
    **Compara contra 41/34.**

11. **Para cambiar de modo se usa `fijar({modo:'oscuro'}, false)`, nunca
    `ponerModo()`.** ponerModo aplica las fichas pero no pone `data-piel`, que
    es el atributo que voltea por CSS las superficies que no siguen al tono
    (tarjetas `#fff`, topbar, about `#e9eff8`). Medir con ponerModo da 69 y
    parece que el modo oscuro está roto. El `false` evita ensuciar
    sessionStorage.

## Desplegar

- Portfolio: push a `main` → Cloudflare Pages despliega solo.
- Worker: `npx wrangler deploy` en `agente/` (wrangler ya autenticado). Un
  origen nuevo NO funciona hasta desplegar el worker — el síntoma es un chat
  mudo sin error visible.
- Humo post-deploy: `python verificar-agentes.py` (o el subagente
  `verificador-humo`).

## Los dos guardias que corren solos

En el worker, por cron a las 9:00 UTC. No necesitan sesión abierta, ni laptop
prendida, ni tokens de nadie — y por eso son el lugar correcto para todo lo que
no es trabajo de juicio.

- **`verificador.js`** mira hacia adentro: la base contra sí misma, KV contra D1,
  leads sin entregar, mensajes huérfanos.
- **`vigilante.js`** mira hacia afuera: los cuatro sitios publicados (relleno,
  correos muertos), que el taller siga cerrado, el control de origen, y los
  rebotes de Resend (sólo si existe `RESEND_API_KEY` como secreto).

Los dos callan si todo cuadra — un parte diario de "todo bien" se vuelve ruido.
Cada corrida del vigilante queda en la tabla `vigilancia` de D1, encuentre o no,
para poder distinguir *"revisado hace 3 h, limpio"* de *"nunca corrió"*.

Para dispararlo sin esperar al cron: `POST /bandeja/vigilancia` con el token de
la bandeja (misma puerta, a propósito: una puerta nueva es superficie nueva).

**`/tablero`** es donde se ve todo junto: estado de los guardias y sus hallazgos,
conversaciones del día, leads sin abrir, **avisos perdidos** (la cifra más cara:
un lead que existió y no te llegó), cuota del día contra el tope, y el correo
frío. Mismo token que la bandeja y **la misma función** `autorizado` — se
comparte, no se copia: dos copias de un control de acceso divergen, y la que se
queda vieja es la que abre. Trae un botón "Revisar ahora" que dispara al
vigilante. Ninguna consulta del tablero toca la API del modelo: cuesta cero.

**El escuadrón es la escalación, no el motor.** Lo que se puede comparar fuente
contra fuente lo hace el cron gratis; lo que exige criterio —si una cifra es
sostenible, si un texto miente— es lo único que vale gastar en un agente.

### `origenesDev` no es cosmético

Los orígenes de desarrollo van en `origenesDev` de la ficha, **nunca** en
`origenes`. Sólo cuentan con `MODO_DEV` puesto, que el worker desplegado no
tiene. El 2026-08-25 se encontró `http://localhost:4322` entre los de
producción: `curl -H 'Origin: http://localhost:4322' .../chat` devolvía **200** y
gastaba cuota. La cabecera Origin la pone el navegador, pero cualquier cosa que
no sea un navegador la escribe a mano.

## Qué skill se activa con qué

Hay ~85 skills cargadas y sólo dos son de la casa. Esta lista es para
activarlas **sin que se pidan**, y sobre todo para no arrastrar a este repo las
que pertenecen a otro stack.

**Una skill no reemplaza a un guardia.** El orden es: la skill hace el trabajo,
el subagente da el visto bueno. `security-review` no exime de `auditor-rojo`
(regla 7); ninguna skill de diseño exime de `critico-visual`.

### Obligatorias, por disparador

- **Tocar `agente/`** — prompt, herramientas, ids de modelo, SDK → `claude-api`
  **antes de abrir el archivo**. Es lo que impide "arreglar" el import de
  Anthropic sobre DeepSeek (regla 8) y lo que trae los ids vigentes en vez de
  los que yo recuerde. Después del cambio: `auditor-rojo`.
- **Cambio con consecuencia pública** — worker, endpoints, CORS, tokens,
  `origenes` → `security-review` sobre el diff, antes de desplegar. Complementa
  al auditor: uno lee el código, el otro ataca lo que ya está en vivo.
- **Antes de empujar cualquier diff** → `code-review`. Con `ultra` si toca la
  puerta de bandeja/tablero, `autorizado`, o el motor de fichas.
- **Cara nueva del sitio** — `index.html`, `piel.js`, `bloques.js`, pieles,
  modo oscuro → `industrial-brutalist-ui` o `frontend-design` para proponerla,
  `critico-visual` para medirla. Canto duro y rejilla, no vidrio.
- **Gráficas del `/tablero`** → `dataviz` antes de la primera línea de chart, y
  la misma línea base de contraste: 41/34, columna de lectura en 6.
- **Tocar `.claude/settings.json`** — enganches, permisos, env →
  `update-config`. No hay `jq`, y los enganches sólo se leen al arrancar.
- **Un reporte o informe que va a leer alguien más** → `artifact-design` antes
  de escribir el HTML.

### Útiles cuando aplican

- `simplify` — limpieza de código ya escrito. Calidad, no cacería de bugs.
- `skill-creator` — cuando un trabajo se repitió tres veces **y salió igual las
  tres**. Si salió distinto al menos una, es agente (`fabrica-de-agentes`).
- `docx` / `pdf` / `xlsx` / `pptx` — entregables a cliente. No entran al repo.
- `responder-del-stack` / `reextraer-guia` — preguntas de stack de HAILO.
- `consolidate-memory` / `explain-usage` — mantenimiento, sólo si se piden.
- `watch-and-learn` — convertir un video en skill.

### Las que NO aplican aquí

**Todo `vercel:*` y todo `clerk:*`.** Esto es Cloudflare Pages + Workers, sin
build y sin auth de usuarios. Si una de ésas aparece en este repo, me equivoqué
de proyecto: pertenecen a `taller-hailo` y a T Dental. El MCP de Vercel además
no está autorizado en esta sesión.

**`loop` y `schedule` para vigilar.** Ya hay dos guardias en cron del worker a
las 9:00 UTC que corren sin sesión abierta ni laptop prendida. Un `/loop` que
vigile lo mismo es peor: se muere al cerrar la terminal. Programar sólo lo que
exige criterio — comparar fuente contra fuente ya lo hace el cron gratis.

**`run` e `init`.** No hay servidor de desarrollo, es estático: se abre con el
Browser pane, y con la regla 9 presente — el pane no compone.

### El encargo: de un objetivo a trabajo corriendo

Cuando el pedido no es una tarea sino un objetivo —*"quiero hacer todo esto,
haz los prompts necesarios y ejecútalos"*— la entrada es **`/encargo`**
(`.claude/skills/encargo/SKILL.md`). Parte el objetivo en piezas, le asigna a
cada una su skill y su guardia, y las corre con el workflow homónimo
(`.claude/workflows/encargo.js`). Daniel dice el objetivo; las tareas, los
prompts y los comandos son trabajo mío.

Lo que lo separa de "lanzar agentes y ver qué sale":

- **El paralelismo es por archivos disjuntos**, no por worktree. Dos piezas que
  comparten archivo se serializan solas. El worktree no sirve aquí: `.claude/`
  está en `.gitignore`, así que un agente aislado se queda sin fronteras y sin
  guardias.
- **Los guardias en vivo corren UNA vez por encargo**, contra el estado final.
  13 ataques son 13 de los 40 del día (frontera 7): uno por pieza sería vaciar
  la cuota midiendo pasos intermedios.
- **El workflow no despliega.** Construye y mide; aplicar, commitear, desplegar
  y verificar lo cierra el principal, que sí está en la conversación.
- **Tope de 6 piezas** — son 2 agentes cada una y el techo de sesión es 15. Más
  que eso son varios encargos en fila, y entre uno y otro se corrige el rumbo.

**La frontera de los constructores es de papel.** Un guardia invocado por
`agentType` no tiene `Write` por su ficha; los agentes que construyen tienen
todo, y lo único que les impide desplegar es el preámbulo del script. Si una
pieza es peligrosa, no se delega.

## El escuadrón

Cinco subagentes en `.claude/agents/`. La política que todos respetan está en
`.claude/fronteras.md`; el roster y cómo crece, en `.claude/escuadron.md`. Las
corridas con consecuencia dejan línea en `.claude/bitacora/`.

- `critico-visual` — dirección de arte y contraste, antes de dar por buena
  cualquier cara nueva del sitio.
- `auditor-rojo` — batería de ataques al agente público; obligatorio tras
  cualquier cambio de prompt/herramientas.
- `redactor-bilingue` — paridad es/en, relleno, promesas públicas y correos
  muertos.
- `verificador-humo` — humo mecánico contra el sitio y el worker en vivo.
- `fabrica-de-agentes` — crea agentes nuevos. Regla: el trabajo se repitió tres
  veces y salió distinto al menos una. Igual siempre = script, no agente.

**Cuatro de los cinco no pueden escribir**, a propósito: un auditor que arregla
lo que encuentra deja de ser segunda opinión.

### Si sale `Agent type 'X' not found`

El registro de subagentes se toma **al arrancar la sesión**: una ficha creada o
renombrada a media sesión no es invocable hasta reiniciar. No hay comando de
recarga, y `/agents` ya no abre panel (desde 2.1.198 sólo imprime rutas).

**Para verificar que cargaron:** pídele al agente principal *"comprueba qué
subagentes tienes disponibles"*. Intenta una invocación y la lista sale del
resultado. Preguntar "status de los agentes" NO dispara ninguno — sus
descripciones se activan con trabajo real, no con preguntas sobre sí mismos.

**Mientras no carguen**, el rodeo probado es lanzar `general-purpose`
diciéndole que lea su ficha en `.claude/agents/` y la siga. Se pierde sólo el
acotamiento por el campo `tools:`.

Las herramientas que ejecutan:

```bash
python .claude/guardias/reatacar.py --rapido    # 6 ataques (sin bandera, 13)
```
```bash
python .claude/guardias/pudricion.py            # relleno, correos, ligas
```
```bash
python .claude/guardias/destrabar.py --si       # libera la cuota diaria topada
```
```bash
python .claude/guardias/ciclo.py ver            # hallazgos abiertos sin disponer
```

**El ciclo ya no depende de que alguien se acuerde.** Dos enganches en
`.claude/settings.json`: al terminar un auditor se abre sola una entrada en
`.claude/hallazgos.json`, y el `Stop` **bloquea el fin del turno** mientras
quede algo sin disponer. Se dispone con `ciclo.py cerrar <id> --medida "..."`
(exige el número re-medido) o `ciclo.py aplazar <id> --motivo "..."` (queda a la
vista). Ver la frontera 2 en `.claude/fronteras.md`.

**Los enganches se leen al arrancar la sesión**, igual que las fichas de
subagente: crear o tocar `settings.json` a media sesión no los activa hasta
reiniciar. Y **no hay `jq` en esta máquina** — cualquier enganche nuevo se
escribe en Python con la forma `args`, sin shell de por medio.

`.claude/guardias/contraste.js` se pega en la consola del navegador
(`nervContrasteEstados()`).

**La cuota tiene DOS contadores por máquina**, uno por IPv4 y otro por IPv6:
Python sale por IPv6 y el navegador a veces por IPv4, así que la cubeta que se
agota rara vez es la que uno cree. La fecha de la clave es **UTC**, no local.
Nunca se le puso bypass al worker a propósito — sería superficie de
autenticación nueva en un endpoint público, por comodidad de prueba.

**`.claude/` está en `.gitignore`**: el escuadrón es local y no se publica.
También significa que no está respaldado.
