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

        claro original ....... 49 bajo 4.5:1   (10 con texto >=14px)
        modo oscuro .......... 33              (7)
        morado sobre claro ... 49   <- idéntico a su base
        rojo sobre oscuro .... 33   <- idéntico a su base

    **Lo que se protege no es el número, es la última columna:** una piel
    derivada debe dar EXACTAMENTE el mismo conteo que su modo base. Si da más,
    se rompió el motor de luminancia — ése es el hallazgo. Auditar TODOS los
    pares reales de color, no sólo tinta/papel.

    Los `17 / 11` que circulaban salieron de un barrido que nunca se guardó, con
    otra regla. No son comparables (aunque la relación coincide: 49:33 y 17:11
    son ambos ≈1.5). **Compara contra 49/33.**

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

`.claude/guardias/contraste.js` se pega en la consola del navegador
(`nervContrasteEstados()`).

**La cuota tiene DOS contadores por máquina**, uno por IPv4 y otro por IPv6:
Python sale por IPv6 y el navegador a veces por IPv4, así que la cubeta que se
agota rara vez es la que uno cree. La fecha de la clave es **UTC**, no local.
Nunca se le puso bypass al worker a propósito — sería superficie de
autenticación nueva en un endpoint público, por comodidad de prueba.

**`.claude/` está en `.gitignore`**: el escuadrón es local y no se publica.
También significa que no está respaldado.
