/* Worker del agente del portfolio.
   Existe por una sola razón: la llave de la API no puede vivir en el navegador.
   Todo lo demás aquí es lo que hace falta para exponer un endpoint público sin
   que sea una llave abierta a tu tarjeta.

   Corre sobre DeepSeek. Sigue importando el SDK de Anthropic a propósito:
   DeepSeek publica un endpoint compatible en /anthropic que habla exactamente
   esa forma de request — system arriba, tools con input_schema, streaming
   igual. Es la ruta que DeepSeek documenta, y deja el loop de herramientas tal
   cual en vez de reescribirlo contra otro formato. */

import Anthropic from '@anthropic-ai/sdk';
import { SISTEMA, HERRAMIENTAS, ejecutar } from './persona.js';

const BASE = 'https://api.deepseek.com/anthropic';
const MODELO = 'deepseek-v4-pro';

// Un chat, no un ensayo.
const MAX_TOKENS = 2048;

// Topes diarios. El primero frena a una persona, el segundo frena a todas —
// sin el global, mil visitantes legítimos también te vacían la cuenta.
const TOPE_POR_IP = 40;
const TOPE_GLOBAL = 800;

// Cotas de entrada. Un historial largo se paga en cada turno, así que se corta.
const MAX_LARGO_MENSAJE = 1500;
const MAX_TURNOS = 16;
const MAX_VUELTAS_HERRAMIENTA = 4;

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function cors(origen, permitidos) {
  if (!origen || !permitidos.includes(origen)) return null;
  return {
    'access-control-allow-origin': origen,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(cuerpo, estado, cabeceras) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cabeceras },
  });
}

/* Devuelve null si hay cupo, o el motivo si ya no. KV es de consistencia
   eventual: dos peticiones simultáneas pueden colarse por encima del tope. Da
   igual — esto es un tope de gasto, no un candado de seguridad. */
async function cupo(kv, ip) {
  if (!kv) return null;
  const fecha = hoy();
  const claveIp = `ip:${ip}:${fecha}`;
  const claveTotal = `total:${fecha}`;

  const [crudoIp, crudoTotal] = await Promise.all([
    kv.get(claveIp),
    kv.get(claveTotal),
  ]);
  const usoIp = Number(crudoIp) || 0;
  const usoTotal = Number(crudoTotal) || 0;

  if (usoIp >= TOPE_POR_IP) return 'Llegaste al límite de mensajes por hoy.';
  if (usoTotal >= TOPE_GLOBAL) return 'El agente alcanzó su cuota del día.';

  // 48 h de vida: cubre el día en curso sin importar la zona horaria.
  const opciones = { expirationTtl: 172800 };
  await Promise.all([
    kv.put(claveIp, String(usoIp + 1), opciones),
    kv.put(claveTotal, String(usoTotal + 1), opciones),
  ]);
  return null;
}

/* El navegador manda {rol, texto} y nada más. Nunca aceptamos bloques de
   contenido crudos: si lo hiciéramos, cualquiera podría inyectar un
   tool_result falso y hacer que el agente afirme lo que se le antoje. */
function historial(crudo) {
  if (!Array.isArray(crudo)) return [];
  return crudo
    .slice(-MAX_TURNOS)
    .filter((m) => m && (m.rol === 'yo' || m.rol === 'agente') && typeof m.texto === 'string')
    .map((m) => ({
      role: m.rol === 'yo' ? 'user' : 'assistant',
      content: m.texto.slice(0, MAX_LARGO_MENSAJE),
    }))
    .filter((m) => m.content.trim().length > 0);
}

export default {
  async fetch(peticion, env) {
    const permitidos = String(env.ORIGENES || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const cabecerasCors = cors(peticion.headers.get('origin'), permitidos);

    if (peticion.method === 'OPTIONS') {
      return cabecerasCors
        ? new Response(null, { status: 204, headers: cabecerasCors })
        : new Response(null, { status: 403 });
    }
    if (!cabecerasCors) return json({ error: 'origen no permitido' }, 403, {});
    if (peticion.method !== 'POST') return json({ error: 'usa POST' }, 405, cabecerasCors);
    if (!env.DEEPSEEK_API_KEY) {
      // El detalle va al log, no a la respuesta: nombrar la variable que falta
      // le describe tu configuración a cualquiera que llame al endpoint.
      console.error('falta el secreto DEEPSEEK_API_KEY');
      return json({ error: 'El agente no está disponible.' }, 503, cabecerasCors);
    }

    let cuerpo;
    try {
      cuerpo = await peticion.json();
    } catch {
      return json({ error: 'cuerpo inválido' }, 400, cabecerasCors);
    }

    const pregunta = String(cuerpo.mensaje || '').slice(0, MAX_LARGO_MENSAJE).trim();
    if (!pregunta) return json({ error: 'mensaje vacío' }, 400, cabecerasCors);

    const ip = peticion.headers.get('cf-connecting-ip') || 'desconocida';
    const sinCupo = await cupo(env.CUOTA, ip);
    if (sinCupo) return json({ error: sinCupo }, 429, cabecerasCors);

    const mensajes = [...historial(cuerpo.historial), { role: 'user', content: pregunta }];
    const cliente = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: BASE });

    const { readable, writable } = new TransformStream();
    const escritor = writable.getWriter();
    const codificador = new TextEncoder();

    const enviar = (evento, datos) =>
      escritor
        .write(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`))
        .catch(() => {});

    (async () => {
      // El endpoint de DeepSeek acepta system, tools, tool_choice y stream, pero
      // no las banderas propias de la plataforma de Anthropic — nada de betas,
      // fallbacks ni output_config aquí.
      let huboTexto = false;
      try {
        for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTA; vuelta++) {
          const flujo = cliente.messages.stream({
            model: MODELO,
            max_tokens: MAX_TOKENS,
            system: SISTEMA,
            tools: HERRAMIENTAS,
            messages: mensajes,
          });

          flujo.on('text', (delta) => {
            huboTexto = true;
            enviar('texto', { t: delta });
          });
          const mensaje = await flujo.finalMessage();

          const usos = mensaje.content.filter((b) => b.type === 'tool_use');
          if (mensaje.stop_reason === 'end_turn' || usos.length === 0) break;

          // El turno del asistente se devuelve tal cual, con todos sus bloques
          // — recortarlo rompe la correspondencia con los tool_use_id de abajo.
          mensajes.push({ role: 'assistant', content: mensaje.content });

          const resultados = [];
          for (const uso of usos) {
            const { resultado, accion } = ejecutar(uso.name, uso.input, env);
            if (accion) await enviar('accion', accion);
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: resultado,
            });
          }
          mensajes.push({ role: 'user', content: resultados });
        }
        // Un turno que termina sin una sola letra deja al visitante mirando una
        // burbuja vacía. Pasa si el modelo declina, si se corta, o si sólo llamó
        // herramientas: siempre hay que decir algo.
        if (!huboTexto) {
          await enviar('texto', {
            t: 'Esa no la supe contestar. ¿Quieres que te pase el contacto directo de Daniel?',
          });
        }
        await enviar('fin', {});
      } catch (e) {
        const publico =
          e instanceof Anthropic.RateLimitError
            ? 'El agente está saturado. Intenta en un minuto.'
            : 'Algo se rompió de mi lado.';
        await enviar('error', { mensaje: publico });
        console.error('fallo del agente:', e);
      } finally {
        await escritor.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        ...cabecerasCors,
      },
    });
  },
};
