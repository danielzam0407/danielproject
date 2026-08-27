/* Lo que comparten los dos canales.

   El agente vivía en un solo lugar —el navegador— y todo el motor estaba
   dentro del `fetch` de index.js. Al aparecer WhatsApp hubo que decidir entre
   copiar el loop o partirlo, y copiarlo ya salió caro una vez en este mismo
   repo: dos copias de un motor divergen, y la que se queda vieja es la que
   sigue corriendo en producción sin que nadie lo note.

   Así que aquí vive lo que NO puede tener dos versiones: el id del modelo, los
   topes, la cuota y el orden de guardar-luego-entregar un aviso.

   Lo que sí tiene dos versiones —el loop— está a propósito: el del sitio
   transmite por SSE y dibuja botones en el chat; el de WhatsApp devuelve un
   texto y ya. Son dos formas distintas de la misma conversación, no dos copias
   de lo mismo. Lo que las mantiene juntas son las constantes de arriba. */

import * as almacen from './almacen.js';
import * as avisos from './avisos.js';

export const BASE = 'https://api.deepseek.com/anthropic';
export const MODELO = 'deepseek-v4-pro';

// Un chat, no un ensayo.
export const MAX_TOKENS = 2048;

// Cotas de entrada.
export const MAX_LARGO_MENSAJE = 1500;
export const MAX_VUELTAS_HERRAMIENTA = 4;

export function hoy() {
  return new Date().toISOString().slice(0, 10);
}

/* Devuelve null si hay cupo, o el motivo si ya no. KV es de consistencia
   eventual: dos peticiones simultáneas pueden colarse por encima del tope. Da
   igual — esto es un tope de gasto, no un candado de seguridad.

   Las claves llevan el id del cliente porque si no, la primera empresa que se
   ponga de moda le agota la cuota del día a todas las demás.

   `quien` es de dónde viene la persona: la IP en el sitio, el id de
   conversación de Kapso en WhatsApp. Nunca el número de teléfono — esa clave
   se queda 48 h en KV y no hay razón para que un dato personal viva ahí. */
export async function cupo(kv, clienteId, quien, topes) {
  if (!kv) return null;
  const fecha = hoy();
  const claveIp = `${clienteId}:ip:${quien}:${fecha}`;
  const claveTotal = `${clienteId}:total:${fecha}`;

  const [crudoIp, crudoTotal] = await Promise.all([kv.get(claveIp), kv.get(claveTotal)]);
  const usoIp = Number(crudoIp) || 0;
  const usoTotal = Number(crudoTotal) || 0;

  if (usoIp >= topes.porIp) return 'Llegaste al límite de mensajes por hoy.';
  if (usoTotal >= topes.global) return 'El agente alcanzó su cuota del día.';

  // 48 h de vida: cubre el día en curso sin importar la zona horaria.
  const opciones = { expirationTtl: 172800 };
  await Promise.all([
    kv.put(claveIp, String(usoIp + 1), opciones),
    kv.put(claveTotal, String(usoTotal + 1), opciones),
  ]);
  return null;
}

/* Levanta un aviso: primero lo escribe, luego intenta entregarlo.

   Ese orden es el punto. Si entregáramos primero y escribiéramos después, un
   fallo de Telegram borraría el lead del mundo. Así queda constancia, y si la
   entrega falla el verificador lo encuentra esa noche con `entregado = 0`. */
export async function levantarAviso(env, clienteId, sesionId, aviso, hilo) {
  let id = null;
  try {
    id = await almacen.registrarAviso(env.DB, sesionId, clienteId, aviso);
  } catch (e) {
    console.error('no se pudo registrar el aviso:', e);
  }
  const salio = await avisos.porTelegram(env, aviso, hilo);
  if (salio && id !== null) {
    try {
      await almacen.marcarEntregado(env.DB, id);
    } catch (e) {
      console.error('no se pudo marcar el aviso como entregado:', e);
    }
  }
}

/* El loop de herramientas sin transmitir, para los canales que no tienen
   pantalla que ir pintando. Devuelve el texto completo y los avisos que se
   levantaron en el camino — que los entregue quien llama, porque de eso
   depende con qué hilo se acompañan.

   No emite `accion`: una acción es un botón dibujado en el chat del sitio, y
   en WhatsApp no hay dónde dibujarlo. El canal que use esto debe traer
   herramientas cuyo `resultado` se baste solo. */
export async function responder(cliente, { sistema, herramientas, ejecutar, ajustes, mensajes }) {
  let dicho = '';
  const levantados = [];

  for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTA; vuelta++) {
    // Mismo endpoint compatible que el sitio: system arriba, tools con
    // input_schema. Nada de banderas propias de la plataforma de Anthropic.
    const mensaje = await cliente.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: sistema,
      tools: herramientas,
      messages: mensajes,
    });

    for (const bloque of mensaje.content) {
      if (bloque.type !== 'text' || !bloque.text) continue;
      // El modelo suele escribir antes de llamar la herramienta y otra vez
      // después: son dos tramos del mismo turno y el corte hay que dibujarlo.
      dicho += (dicho ? '\n' : '') + bloque.text;
    }

    const usos = mensaje.content.filter((b) => b.type === 'tool_use');
    if (mensaje.stop_reason === 'end_turn' || usos.length === 0) break;

    // El turno del asistente se devuelve tal cual, con todos sus bloques —
    // recortarlo rompe la correspondencia con los tool_use_id de abajo.
    mensajes.push({ role: 'assistant', content: mensaje.content });

    const resultados = [];
    for (const uso of usos) {
      const { resultado, aviso } = ejecutar(uso.name, uso.input, ajustes);
      if (aviso) levantados.push(aviso);
      resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: resultado });
    }
    mensajes.push({ role: 'user', content: resultados });
  }

  return { texto: dicho.trim(), avisos: levantados };
}
