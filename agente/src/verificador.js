/* El verificador diario.

   Su única idea, robada de un sistema que lleva meses en producción: *todos los
   errores se encuentran comparando una fuente contra otra*. No revisa que el
   código esté bien — revisa que dos cosas que deberían decir lo mismo lo digan.

   Corre por cron. Si todo cuadra, no te escribe: un verificador que manda un
   parte diario "todo bien" se convierte en ruido y dejas de leerlo. */

import { todas } from './clientes/index.js';
import * as avisos from './avisos.js';

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function hace(horas) {
  return new Date(Date.now() - horas * 3600 * 1000).toISOString();
}

export async function verificar(env) {
  const hallazgos = [];
  if (!env.DB) return ['no hay base: el verificador no puede revisar nada'];

  for (const ficha of todas()) {
    const c = ficha.id;

    // ── 1. Leads que existieron y no te llegaron ───────────────────────────
    // El aviso se escribe antes de intentar entregarlo. Un 0 aquí es un lead
    // que se perdió en el camino a Telegram.
    const perdidos = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM avisos WHERE cliente = ? AND entregado = 0 AND cuando > ?')
      .bind(c, hace(24))
      .first();
    if (perdidos && perdidos.n > 0) {
      hallazgos.push(`${c}: ${perdidos.n} aviso(s) sin entregar en 24 h — revisa Telegram`);
    }

    // ── 2. Dos contadores del mismo día que deberían coincidir ─────────────
    // KV cuenta al cobrar el cupo; la base cuenta al guardar el turno. Son
    // caminos distintos: si se separan mucho, uno de los dos no está corriendo.
    const fecha = hoy();
    const enKv = Number(await env.CUOTA?.get(`${c}:total:${fecha}`)) || 0;
    const enBase = await env.DB
      .prepare(
        'SELECT COUNT(*) AS n FROM mensajes m JOIN sesiones s ON s.id = m.sesion ' +
        "WHERE s.cliente = ? AND m.rol = 'visitante' AND m.cuando LIKE ?"
      )
      .bind(c, `${fecha}%`)
      .first();
    const base = enBase ? enBase.n : 0;
    // KV es de consistencia eventual y el día corre en UTC: una diferencia
    // pequeña es normal. Una grande no.
    const brecha = Math.abs(enKv - base);
    if (brecha > 5 && brecha > Math.max(enKv, base) * 0.25) {
      hallazgos.push(
        `${c}: el cupo dice ${enKv} turnos hoy y la base dice ${base} — se separaron ${brecha}`
      );
    }

    // ── 3. Leads sin atender ───────────────────────────────────────────────
    const dormidos = await env.DB
      .prepare(
        'SELECT COUNT(*) AS n FROM sesiones s WHERE s.cliente = ? AND s.atendida = 0 ' +
        'AND s.vista < ? AND EXISTS (SELECT 1 FROM avisos a WHERE a.sesion = s.id)'
      )
      .bind(c, hace(24))
      .first();
    if (dormidos && dormidos.n > 0) {
      hallazgos.push(`${c}: ${dormidos.n} conversación(es) con lead sin abrir hace más de un día`);
    }

    // ── 4. Integridad: mensajes sin sesión ─────────────────────────────────
    // No debería pasar nunca. Si pasa, algo escribió por fuera del almacén.
    const huerfanos = await env.DB
      .prepare(
        'SELECT COUNT(*) AS n FROM mensajes m LEFT JOIN sesiones s ON s.id = m.sesion ' +
        'WHERE s.id IS NULL'
      )
      .first();
    if (huerfanos && huerfanos.n > 0) {
      hallazgos.push(`${c}: ${huerfanos.n} mensaje(s) sin sesión — alguien escribe por fuera`);
    }
  }

  if (hallazgos.length) await avisos.parte(env, hallazgos);
  return hallazgos;
}
