/* El aviso que te llega a ti en cuanto alguien muestra intención.

   Sigue sin depender de que el visitante toque el botón: puede leer el mensaje
   que el agente le preparó, cerrar la pestaña y nunca enviarlo. Sin esto ese
   lead no existió.

   Lo nuevo es que el aviso ya quedó escrito en la base antes de llegar aquí.
   Telegram es ahora la *entrega*, no el registro. Si falla, el lead sigue vivo
   y el verificador lo ve esa noche. */

const TELEGRAM = 'https://api.telegram.org';

/* Nunca lanza. Que Telegram falle no puede tumbar la conversación del
   visitante, que es lo único que él ve. Devuelve true sólo si de verdad salió. */
export async function porTelegram(env, aviso, conversacion) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const hilo = conversacion
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'visitante' : 'agente'}: ${m.content}`)
    .join('\n');

  const texto =
    `lead — ${aviso.titulo}\n\n${aviso.cuerpo}\n\n` +
    `---- conversación ----\n${hilo}`;

  try {
    const r = await fetch(`${TELEGRAM}/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Sin parse_mode a propósito: el texto lo escribió un desconocido y
      // cualquier símbolo suelto rompería el formateo de Telegram.
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: texto.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      console.error('telegram respondió', r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('no se pudo avisar por telegram:', e);
    return false;
  }
}

/* El parte del verificador. Va por el mismo canal pero no es un lead, así que
   se marca distinto: si se mezclan, dejas de leer los dos. */
export async function parte(env, lineas) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const texto = `verificador\n\n${lineas.join('\n')}`;
  try {
    const r = await fetch(`${TELEGRAM}/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: texto.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    });
    return r.ok;
  } catch (e) {
    console.error('no se pudo mandar el parte:', e);
    return false;
  }
}
