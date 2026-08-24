/* La plomería del molde. Esto no se toca para dar de alta una empresa.

   Existe por una sola razón original: la llave de la API no puede vivir en el
   navegador. Todo lo demás aquí es lo que hace falta para exponer un endpoint
   público sin que sea una llave abierta a tu tarjeta.

   Corre sobre DeepSeek. Sigue importando el SDK de Anthropic a propósito:
   DeepSeek publica un endpoint compatible en /anthropic que habla exactamente
   esa forma de request — system arriba, tools con input_schema, streaming
   igual. Es la ruta que DeepSeek documenta, y deja el loop de herramientas tal
   cual en vez de reescribirlo contra otro formato.

   Lo que cambió al volverse molde:
     · El cliente lo decide el ORIGEN, no un campo del cuerpo. Un campo lo
       escribe el navegador, y entonces cualquiera podría gastarse la cuota
       ajena o escribir en la bandeja de otra empresa.
     · El historial sale de la base, nunca del navegador. Antes venía en la
       petición, y eso permitía mandar turnos de *agente* inventados. */

import Anthropic from '@anthropic-ai/sdk';
import { porOrigen } from './clientes/index.js';
import * as almacen from './almacen.js';
import * as avisos from './avisos.js';
import * as bandeja from './bandeja.js';
import { verificar } from './verificador.js';

const BASE = 'https://api.deepseek.com/anthropic';
const MODELO = 'deepseek-v4-pro';

// Un chat, no un ensayo.
const MAX_TOKENS = 2048;

// Cotas de entrada.
const MAX_LARGO_MENSAJE = 1500;
const MAX_VUELTAS_HERRAMIENTA = 4;

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function cors(origen) {
  return {
    'access-control-allow-origin': origen,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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
   igual — esto es un tope de gasto, no un candado de seguridad.

   Las claves llevan el id del cliente porque si no, la primera empresa que se
   ponga de moda le agota la cuota del día a todas las demás. */
async function cupo(kv, clienteId, ip, topes) {
  if (!kv) return null;
  const fecha = hoy();
  const claveIp = `${clienteId}:ip:${ip}:${fecha}`;
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
async function levantarAviso(env, clienteId, sesionId, aviso, hilo) {
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

export default {
  async fetch(peticion, env) {
    const ruta = new URL(peticion.url).pathname;

    // La bandeja va antes del control de origen: no es un cliente, eres tú.
    const deBandeja = await bandeja.atender(peticion, env, ruta);
    if (deBandeja) return deBandeja;

    // El origen decide de quién es esta petición. Si no es de nadie, 403 sin
    // llegar a la API — el navegador no decide esto, lo decide el servidor.
    const origen = peticion.headers.get('origin');
    const ficha = porOrigen(origen);

    if (peticion.method === 'OPTIONS') {
      return ficha
        ? new Response(null, { status: 204, headers: cors(origen) })
        : new Response(null, { status: 403 });
    }
    if (!ficha) return json({ error: 'origen no permitido' }, 403, {});

    const cabecerasCors = cors(origen);
    const ajustes = ficha.ajustes(env);

    // El botón de WhatsApp del sitio pide la URL aquí en vez de traerla escrita.
    // Así el número no vive en un repo público —donde lo raspa cualquier bot de
    // spam— y hay un solo lugar donde cambiarlo el día que cambie.
    if (peticion.method === 'GET' && ruta === '/contacto') {
      const numero = ajustes.whatsapp;
      return json(
        {
          whatsapp: numero
            ? `https://wa.me/${numero}?text=${encodeURIComponent(ajustes.saludoWhatsapp || '')}`
            : null,
        },
        200,
        // Una hora de caché: el número no cambia, y sin esto cada visita al
        // sitio despierta al worker para contestar lo mismo.
        { ...cabecerasCors, 'cache-control': 'public, max-age=3600' }
      );
    }

    /* El visitante recupera su propio hilo al recargar. El id es de 122 bits y
       vive sólo en su navegador — el mismo modelo de una cookie de sesión.
       Devuelve turnos y nada más: ni avisos, ni IP, ni cuándo. */
    if (peticion.method === 'GET' && ruta === '/hilo') {
      if (!env.DB) return json({ turnos: [] }, 200, { ...cabecerasCors, 'cache-control': 'no-store' });
      const id = new URL(peticion.url).searchParams.get('sesion') || '';
      const turnos = await almacen.hiloVisitante(env.DB, ficha.id, id);
      return json({ turnos: turnos || [] }, 200, { ...cabecerasCors, 'cache-control': 'no-store' });
    }

    if (peticion.method !== 'POST') return json({ error: 'usa POST' }, 405, cabecerasCors);

    if (!env.DEEPSEEK_API_KEY) {
      // El detalle va al log, no a la respuesta: nombrar la variable que falta
      // le describe tu configuración a cualquiera que llame al endpoint.
      console.error('falta el secreto DEEPSEEK_API_KEY');
      return json({ error: 'El agente no está disponible.' }, 503, cabecerasCors);
    }
    if (!env.DB) {
      // Falla ruidosamente a propósito. La alternativa —aceptar el historial
      // del navegador cuando no hay base— es justo el agujero que este molde
      // vino a cerrar, y en silencio.
      console.error('falta el binding DB: corre `npx wrangler d1 create conversaciones` y aplica esquema.sql');
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
    const sinCupo = await cupo(env.CUOTA, ficha.id, ip, ficha.topes);
    if (sinCupo) return json({ error: sinCupo }, 429, cabecerasCors);

    /* La sesión. Si el navegador manda un id que no existe o que es de otro
       cliente, no discutimos: se abre una nueva. Decirle por qué falló es
       decirle a quien prueba ids qué tan cerca estuvo. */
    let sesionId;
    try {
      const previa = await almacen.buscar(env.DB, cuerpo.sesion, ficha.id);
      sesionId = previa ? previa.id : await almacen.abrir(env.DB, ficha.id, ip);
    } catch (e) {
      console.error('fallo el almacén al abrir sesión:', e);
      return json({ error: 'Algo se rompió de mi lado.' }, 503, cabecerasCors);
    }

    // El historial sale de aquí, no de la petición. Esto es lo que impide que
    // alguien le ponga palabras en la boca al agente.
    const previos = await almacen.historial(env.DB, sesionId);
    const mensajes = [...previos, { role: 'user', content: pregunta }];

    // El hilo en texto plano, para el aviso. Aparte de `mensajes` a propósito:
    // ahí dentro los turnos del asistente son bloques, no cadenas, y meterlos
    // en un texto los imprime como [object Object].
    const hilo = [...previos, { role: 'user', content: pregunta }];

    const cliente = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: BASE });

    const { readable, writable } = new TransformStream();
    const escritor = writable.getWriter();
    const codificador = new TextEncoder();

    const enviar = (evento, datos) =>
      escritor
        .write(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`))
        .catch(() => {});

    (async () => {
      // Lo primero que sale: el id de la sesión, para que el navegador lo
      // guarde y el hilo sobreviva a recargar la página.
      await enviar('sesion', { id: sesionId });

      // El endpoint de DeepSeek acepta system, tools, tool_choice y stream, pero
      // no las banderas propias de la plataforma de Anthropic — nada de betas,
      // fallbacks ni output_config aquí.
      let huboTexto = false;
      let dicho = '';
      // El modelo suele escribir antes de llamar la herramienta y otra vez
      // después. Son dos tramos de la misma burbuja, así que el corte entre
      // vueltas hay que dibujarlo — si no, la última palabra de uno queda
      // pegada a la primera del otro.
      let separadorPendiente = false;
      const pendientes = [];
      try {
        await almacen.guardar(env.DB, sesionId, 'visitante', pregunta);

        for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTA; vuelta++) {
          const flujo = cliente.messages.stream({
            model: MODELO,
            max_tokens: MAX_TOKENS,
            system: ficha.sistema,
            tools: ficha.herramientas,
            messages: mensajes,
          });

          flujo.on('text', (delta) => {
            if (separadorPendiente) {
              separadorPendiente = false;
              dicho += '\n';
              enviar('texto', { t: '\n' });
            }
            huboTexto = true;
            dicho += delta;
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
            const { resultado, accion, aviso } = ficha.ejecutar(uso.name, uso.input, ajustes);
            if (accion) await enviar('accion', accion);
            // Sale en paralelo con la siguiente vuelta del modelo, así que no
            // le cuesta tiempo al visitante. Se recoge antes de cerrar.
            if (aviso) {
              pendientes.push(
                levantarAviso(env, ficha.id, sesionId, aviso, [
                  ...hilo,
                  { role: 'assistant', content: dicho },
                ])
              );
            }
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: resultado,
            });
          }
          mensajes.push({ role: 'user', content: resultados });
          if (huboTexto) separadorPendiente = true;
        }

        // Un turno que termina sin una sola letra deja al visitante mirando una
        // burbuja vacía. Pasa si el modelo declina, si se corta, o si sólo llamó
        // herramientas: siempre hay que decir algo.
        if (!huboTexto) {
          const salida = 'Esa no la supe contestar. ¿Quieres que te pase el contacto directo?';
          dicho = salida;
          await enviar('texto', { t: salida });
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
        // Se guarda lo que alcanzó a decir incluso si reventó a media respuesta:
        // media conversación en la bandeja explica mejor un reclamo que ninguna.
        if (dicho.trim()) {
          try {
            await almacen.guardar(env.DB, sesionId, 'agente', dicho);
          } catch (e) {
            console.error('no se pudo guardar el turno del agente:', e);
          }
        }
        // Antes de cerrar: en cuanto se cierra el stream el worker puede
        // terminar, y un aviso a medio salir se pierde en silencio.
        await Promise.allSettled(pendientes);
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

  /* El verificador. Corre por cron y sólo te escribe si algo no cuadra. */
  async scheduled(evento, env, contexto) {
    contexto.waitUntil(
      verificar(env)
        .then((hallazgos) => {
          // Al log siempre, no sólo a Telegram: si el bot no está configurado
          // —o falla— los hallazgos no pueden evaporarse en silencio.
          if (hallazgos.length) console.warn('verificador:', hallazgos.join(' | '));
          else console.log('verificador: todo cuadra');
        })
        .catch((e) => console.error('el verificador falló:', e))
    );
  },
};
