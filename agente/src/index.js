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
import * as tablero from './tablero.js';
import * as whatsapp from './whatsapp.js';
import {
  BASE,
  MODELO,
  MAX_TOKENS,
  MAX_LARGO_MENSAJE,
  MAX_VUELTAS_HERRAMIENTA,
  cupo,
  levantarAviso,
} from './motor.js';
import { verificar } from './verificador.js';
import { vigilar } from './vigilante.js';

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

export default {
  async fetch(peticion, env, contexto) {
    const ruta = new URL(peticion.url).pathname;

    // La bandeja y el tablero van antes del control de origen: no son
    // clientes, eres tú. El tablero reusa la puerta de la bandeja —el mismo
    // token, la misma función— porque dos copias de un control de acceso
    // divergen, y la que se queda vieja es la que abre.
    const deBandeja = await bandeja.atender(peticion, env, ruta);
    if (deBandeja) return deBandeja;

    const deTablero = await tablero.atender(
      peticion, env, ruta, bandeja.autorizado, bandeja.json
    );
    if (deTablero) return deTablero;

    /* WhatsApp también va antes del control de origen, y por una razón que
       conviene tener presente: un webhook NO trae cabecera Origin. El portero
       que protege todo lo de abajo no aplica aquí, así que este canal trae su
       propia puerta —firma HMAC del cuerpo— y es la única que tiene. */
    const deWhatsapp = await whatsapp.atender(peticion, env, ruta, contexto);
    if (deWhatsapp) return deWhatsapp;

    // El origen decide de quién es esta petición. Si no es de nadie, 403 sin
    // llegar a la API — el navegador no decide esto, lo decide el servidor.
    const origen = peticion.headers.get('origin');
    const ficha = porOrigen(origen, env);

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

    /* Cómo se ve la página en la pantalla de quien escribe, ahora mismo. Lo
       reporta el navegador y la ficha lo traduce a texto — validando cada
       campo, porque esto viene del cliente igual que el mensaje. Sin ficha que
       lo entienda, el agente trabaja a ciegas como antes. */
    const estadoPagina =
      typeof ficha.contexto === 'function' ? ficha.contexto(cuerpo.contexto) : '';
    const sistema = estadoPagina ? ficha.sistema + '\n\n' + estadoPagina : ficha.sistema;

    const cliente = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: BASE });

    const { readable, writable } = new TransformStream();
    const escritor = writable.getWriter();
    const codificador = new TextEncoder();

    const enviar = (evento, datos) =>
      escritor
        .write(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`))
        .catch(() => {});

    /* El trabajo se registra con waitUntil.

       Sin esto, cuando el visitante cierra la pestaña a media respuesta el
       runtime puede matar al worker antes de que termine este bloque — y con
       él se van el turno del agente sin guardar y cualquier aviso de lead a
       medio entregar. Verificado: una sesión cortada quedaba con el mensaje
       del visitante y sin el del agente. */
    const trabajo = (async () => {
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
            system: sistema,
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

    contexto.waitUntil(trabajo);

    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        ...cabecerasCors,
      },
    });
  },

  /* Los dos guardias. Corren por cron y sólo te escriben si algo no cuadra.

     `verificar` mira hacia adentro: la base contra sí misma, KV contra D1.
     `vigilar` mira hacia afuera: los sitios publicados, el control de origen,
     el taller que no debe servirse, los rebotes del correo frío.

     Van en paralelo y con `allSettled` a propósito: son independientes, y que
     uno reviente no puede dejar al otro sin correr. Un guardia que se cae
     callado es peor que no tenerlo — ésa es justo la falla que vienen a cerrar. */
  async scheduled(evento, env, contexto) {
    contexto.waitUntil(
      Promise.allSettled([
        verificar(env).then((h) => ['verificador', h]),
        vigilar(env).then((h) => ['vigilante', h]),
      ]).then((resultados) => {
        for (const r of resultados) {
          if (r.status === 'rejected') {
            console.error('un guardia falló:', r.reason);
            continue;
          }
          const [quien, hallazgos] = r.value;
          // Al log siempre, no sólo a Telegram: si el bot no está configurado
          // —o falla— los hallazgos no pueden evaporarse en silencio.
          if (hallazgos.length) console.warn(`${quien}:`, hallazgos.join(' | '));
          else console.log(`${quien}: todo cuadra`);
        }
      })
    );
  },
};
