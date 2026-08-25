/* El vigilante: lo que se pudre en público, revisado sin que nadie esté.

   `verificador.js` compara la base contra sí misma — mira hacia adentro. Éste
   mira hacia AFUERA: los sitios publicados, el control de origen, el taller que
   no debe servirse, y los rebotes del correo frío.

   Por qué vive aquí y no en `.claude/guardias/`: aquellos son scripts que sólo
   corren cuando alguien abre una sesión y se acuerda. Esto corre por cron en
   Cloudflare — esté o no prendida la laptop, haya o no una sesión abierta, y
   sin gastar un solo token de nadie. Casi nada de lo que revisa es trabajo de
   juicio: es comparar dos fuentes, que es exactamente lo que una máquina hace
   mejor y más barato que un agente.

   Lo que SÍ es juicio —si una cifra es sostenible, si un texto miente— se queda
   con `redactor-bilingue`. El vigilante encuentra; el escuadrón opina.

   Misma regla de la casa que el verificador: si todo cuadra, no te escribe. */

import * as avisos from './avisos.js';
import { origenesDeProduccion } from './clientes/index.js';

const UA = { 'user-agent': 'vigilante-nerv/1.0' };

// El único buzón vivo. Todo lo demás en un mailto: es hallazgo.
const CORREO_VIVO = 'dani@nervcenter.online';

const SITIOS = [
  { id: 'nerv', url: 'https://nervcenter.online' },
  { id: 'nerv-www', url: 'https://www.nervcenter.online' },
  { id: 'fracture', url: 'https://danielzam0407.github.io/fracture/' },
  { id: 'pasillo', url: 'https://danielzam0407.github.io/menu-pasillo/' },
];

// Portado de `.claude/guardias/pudricion.py`. El tercer campo es si distingue
// mayúsculas: TODO y FIXME lo EXIGEN, porque `\bTODO\b` sin distinguir se traga
// la palabra española "todo" en cada párrafo — y un guardia que grita lobo se
// deja de leer a la segunda corrida.
const RELLENO = [
  [/(?<![-:\w])placeholder(?![\w-]*\s*=)/, 'relleno literal', false],
  [/\blorem ipsum\b/, 'lorem ipsum', false],
  [/Nombre del proyecto/, 'relleno: nombre del proyecto', false],
  [/Rol placeholder/, 'relleno: rol inventado', false],
  [/\bTODO\b/, 'nota de pendiente publicada', true],
  [/\bFIXME\b/, 'nota de pendiente publicada', true],
  [/\bcoming soon\b/, 'promesa sin fecha', false],
  [/\bpr[oó]ximamente\b/, 'promesa sin fecha', false],
  [/\[email\s*protected\]/, 'ofuscación de Cloudflare rompiendo el CTA', false],
];

/* Rutas del taller que NUNCA deben servirse. Pages publicaba la raíz entera y
   `/agente/src/clientes/daniel.js` daba 200 con el prompt completo del agente.
   Se cerró el 2026-08-25 con la lista TALLER del middleware. Una regresión ahí
   es silenciosa —el sitio se ve idéntico— y por eso se revisa sola. */
const TALLER = [
  '/agente/src/clientes/daniel.js',
  '/agente/src/index.js',
  '/CLAUDE.md',
];

async function pedir(url, opciones = {}) {
  // 10 s: el cron tiene presupuesto y un sitio que tarda más ya es un hallazgo
  // por su cuenta.
  return fetch(url, {
    headers: UA,
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
    ...opciones,
  });
}

/* Cada revisión va envuelta: una que reviente no puede llevarse las demás. Un
   vigilante que se cae entero por un DNS lento es peor que no tenerlo. */
async function intentar(nombre, fn, hallazgos) {
  try {
    await fn();
  } catch (e) {
    hallazgos.push(`${nombre}: la revisión falló (${e.message || e})`);
  }
}

// ── 1. Los sitios responden, y lo que sirven no está podrido ───────────────
async function revisarSitios(hallazgos) {
  for (const sitio of SITIOS) {
    await intentar(sitio.id, async () => {
      const r = await pedir(sitio.url);
      if (!r.ok) {
        hallazgos.push(`${sitio.id}: responde ${r.status} — ${sitio.url}`);
        return;
      }
      const html = await r.text();

      for (const [patron, que, sensible] of RELLENO) {
        const re = new RegExp(patron.source, sensible ? '' : 'i');
        if (re.test(html)) hallazgos.push(`${sitio.id}: ${que}`);
      }

      // Correos muertos. Se miran los mailto: porque son los que alguien va a
      // tocar; un correo suelto en prosa puede ser de un cliente.
      const correos = new Set();
      for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
        correos.add(m[1].toLowerCase());
      }
      for (const correo of correos) {
        if (correo !== CORREO_VIVO) {
          hallazgos.push(`${sitio.id}: mailto a ${correo} — el único vivo es ${CORREO_VIVO}`);
        }
      }
    }, hallazgos);
  }
}

// ── 2. El taller sigue cerrado ─────────────────────────────────────────────
async function revisarTaller(hallazgos) {
  for (const ruta of TALLER) {
    await intentar('taller', async () => {
      const r = await pedir(`https://nervcenter.online${ruta}`);
      // 200 con el contenido de verdad = regresión. El sitio devuelve el
      // index.html en las rutas desconocidas, así que un 200 sólo es hallazgo
      // si lo que vuelve NO es la página.
      if (r.ok) {
        const cuerpo = await r.text();
        if (!cuerpo.includes('<x-dc') && !cuerpo.includes('dc-root')) {
          hallazgos.push(`FUGA: ${ruta} se está sirviendo en público (${r.status})`);
        }
      }
    }, hallazgos);
  }
}

// ── 3. El control de origen sigue vivo ─────────────────────────────────────
/* Un worker que dejó de rechazar orígenes ajenos no se ve distinto desde el
   sitio: sigue funcionando. Se nota el día que alguien más lo está usando con
   la cuenta de Daniel. */
/* Sin red, y por eso es la que de verdad vale.

   La revisión por HTTP de aquí abajo depende de que el worker se alcance a sí
   mismo, y eso a veces no pasa. Ésta no depende de nada: lee la lista de
   orígenes de producción tal cual quedó compilada en el worker.

   Existe porque el 2026-08-25 encontramos que `http://localhost:4322` era un
   origen de PRODUCCIÓN. La cabecera Origin la pone el navegador, pero cualquier
   cosa que no sea un navegador la escribe a mano — y con esa línea, cualquiera
   que leyera el repo podía gastarle la cuota de DeepSeek. Se separó a
   `origenesDev`, que sólo cuenta con MODO_DEV. Esta revisión es para que no
   vuelva a colarse. */
function revisarOrigenesDeclarados(hallazgos) {
  for (const origen of origenesDeProduccion()) {
    let u;
    try {
      u = new URL(origen);
    } catch {
      hallazgos.push(`origen de producción ilegible: ${origen}`);
      continue;
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
      hallazgos.push(`origen de DESARROLLO en producción: ${origen} — cualquiera puede mandarlo`);
    } else if (u.protocol !== 'https:') {
      hallazgos.push(`origen de producción sin https: ${origen}`);
    }
  }
}

async function revisarOrigen(env, hallazgos) {
  const base = env.URL_PUBLICA || 'https://daniel-agente.daniii.workers.dev';

  await intentar('origen', async () => {
    /* CONTROL PRIMERO, y no es ceremonia: es la lección que este archivo ya
       cobró el día que nació.

       Un worker pidiéndose a sí mismo no siempre llega a sí mismo — bajo
       `wrangler dev --remote` la subpetición aterriza en otro lado y devuelve
       404. La primera versión no lo distinguía y gritó "EL CONTROL DE ORIGEN SE
       CAYÓ" cuando lo único caído era mi banco de pruebas. Eso es exactamente
       el guardia que grita lobo, por tercera vez en un día.

       `/bandeja` responde 200 HTML sin token y sin origen. Si ni eso vuelve, la
       subpetición nunca llegó y ningún 403 ni 200 de aquí significa nada. */
    const control = await pedir(`${base}/bandeja`);
    if (!control.ok) {
      hallazgos.push(
        `no pude alcanzarme a mí mismo (${control.status} en /bandeja) — ` +
        'el control de origen quedó SIN REVISAR, no roto'
      );
      return;
    }

    const ajeno = await pedir(`${base}/contacto`, {
      headers: { ...UA, origin: 'https://ejemplo-ajeno.test' },
    });
    if (ajeno.status !== 403) {
      hallazgos.push(
        `el control de origen dejó pasar un origen ajeno (${ajeno.status}, se esperaba 403)`
      );
    }

    const propio = await pedir(`${base}/contacto`, {
      headers: { ...UA, origin: 'https://nervcenter.online' },
    });
    if (!propio.ok) {
      hallazgos.push(`el worker rechaza a su propio sitio (${propio.status} en /contacto)`);
    }
  }, hallazgos);
}

// ── 4. Rebotes del correo frío ─────────────────────────────────────────────
/* La pregunta que hoy sólo se contesta abriendo el panel de Resend a mano:
   ¿los correos que salieron, llegaron? Sin esto, la segunda tanda se manda a
   ciegas repitiendo el error de la primera.

   Sin RESEND_API_KEY no se queja: la revisión simplemente no existe. Un
   hallazgo por una llave que nadie puso es ruido. */
async function revisarCorreo(env, hallazgos) {
  if (!env.RESEND_API_KEY) return;

  await intentar('resend', async () => {
    const r = await pedir('https://api.resend.com/emails?limit=100', {
      headers: { ...UA, authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!r.ok) {
      hallazgos.push(`resend respondió ${r.status} al pedir los envíos`);
      return;
    }
    const datos = await r.json();
    const lista = datos.data || datos.emails || [];
    const malos = lista.filter((e) =>
      ['bounced', 'complained', 'failed'].includes(String(e.last_event || e.status))
    );
    if (malos.length) {
      const detalle = malos
        .slice(0, 8)
        .map((e) => `${(e.to && e.to[0]) || '?'} (${e.last_event || e.status})`)
        .join(', ');
      hallazgos.push(`correo frío: ${malos.length} rebote(s)/queja(s) — ${detalle}`);
    }
  }, hallazgos);
}

// ── el turno completo ──────────────────────────────────────────────────────
export async function vigilar(env) {
  const hallazgos = [];

  revisarOrigenesDeclarados(hallazgos);
  await revisarSitios(hallazgos);
  await revisarTaller(hallazgos);
  await revisarOrigen(env, hallazgos);
  await revisarCorreo(env, hallazgos);

  // Se guarda SIEMPRE, encuentre o no. El parte a Telegram sólo sale si hay
  // algo — pero el tablero necesita poder decir "revisado hace 3 h, limpio",
  // que es distinto de "nunca corrió".
  if (env.DB) {
    try {
      await env.DB
        .prepare('INSERT INTO vigilancia (cuando, hallazgos) VALUES (?, ?)')
        .bind(new Date().toISOString(), JSON.stringify(hallazgos))
        .run();
    } catch (e) {
      console.error('no se pudo guardar la vigilancia:', e);
    }
  }

  if (hallazgos.length) await avisos.parte(env, hallazgos, 'vigilante');
  return hallazgos;
}
