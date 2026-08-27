/* El canal de WhatsApp, por Kapso.

   Hasta aquí el agente vivía sólo en el sitio, y su escalada por defecto era
   `pasar_a_whatsapp`: un botón `wa.me` que abría el WhatsApp de Daniel. Eso
   entregaba la conversación a mano y ahí se terminaba el agente. Esto la
   continúa: quien escribe al número le sigue hablando al MISMO agente —mismo
   perfil, misma base, misma cuota— sin que Daniel tenga que estar.

   Kapso es sólo el cable. Pone un número oficial de WhatsApp Business, manda
   aquí lo que llega y acepta lo que contestamos. No hay agente del lado de
   Kapso, y a propósito: el agente es de la casa y ya pasó por el auditor.

   ── Las cuatro cosas que hacen que esto no sea un agujero ───────────────────

   1. NO HAY ORIGEN. Un webhook no manda cabecera `Origin`, así que
      `porOrigen` —que es LA llave del molde multicliente— no aplica. La
      puerta de este canal es la firma HMAC del cuerpo, y no hay otra. Sin
      `KAPSO_WEBHOOK_SECRET` puesto, el endpoint no contesta nada: prefiere
      estar muerto a estar abierto.

   2. LA CUOTA NO PUEDE IR POR IP. Todas las peticiones vienen de Kapso, así
      que una sola IP gastaría el tope de todos. Va por conversación, que es
      el equivalente honesto de "una persona".

   3. DIEZ SEGUNDOS. Kapso corta a los 10 s y reintenta a los 10, 40 y 90. El
      modelo tarda más que eso, así que se contesta 200 de inmediato y el
      trabajo se va en `waitUntil`. Si no, cada mensaje se contestaría tres
      veces y se pagaría tres veces.

   4. NO SE GUARDA EL TELÉFONO. La sesión se indexa por el id de conversación
      que da Kapso, no por el número. El número se usa para contestar y se va
      con la petición. */

import Anthropic from '@anthropic-ai/sdk';
import { porNumeroWhatsapp } from './clientes/index.js';
import * as almacen from './almacen.js';
import { BASE, MAX_LARGO_MENSAJE, cupo, levantarAviso, responder } from './motor.js';

const API = 'https://api.kapso.ai/meta/whatsapp/v24.0';

// Tope de WhatsApp para un mensaje de texto. Pasarse no da error: corta.
const MAX_LARGO_RESPUESTA = 4096;

/* Cuánto vive el puente charla→sesión. Al vencer, el siguiente mensaje abre
   una conversación nueva en la bandeja en vez de resucitar una de hace dos
   meses. 24 h es la misma ventana en la que WhatsApp deja contestar sin
   plantilla, así que el hilo y el permiso de responder caducan juntos. */
const VIDA_SESION = 86400;

// Lo mismo, para no contestar dos veces el mismo mensaje si Kapso lo repite.
const VIDA_VISTO = 86400;

/* Comparación en tiempo constante de dos cadenas hex. Comparar con `===`
   filtra por cuánto tarda en fallar, y eso deja adivinar la firma byte por
   byte. Escrito a mano en vez de usar `crypto.subtle.timingSafeEqual` porque
   ése revienta si las longitudes no coinciden — y una firma de largo raro es
   justo lo primero que manda quien está probando. */
function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

async function hmacHex(secreto, texto) {
  const codificador = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(texto));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Kapso documenta la firma como HMAC-SHA256 sobre `JSON.stringify(payload)`.
   En su ejemplo `payload` es el cuerpo ya parseado por Express, que para un
   JSON compacto sale byte por byte igual al crudo. Se prueba el crudo primero
   —lo correcto— y si no cuadra se prueba la forma re-serializada, que cubre el
   caso de que lo manden con saltos de línea. Las dos exigen la misma firma
   válida: esto no afloja la puerta, sólo admite las dos maneras de escribirla. */
async function firmaValida(secreto, crudo, recibida) {
  if (!recibida) return false;
  const limpia = String(recibida).trim().toLowerCase().replace(/^sha256=/, '');
  if (iguales(await hmacHex(secreto, crudo), limpia)) return true;
  try {
    return iguales(await hmacHex(secreto, JSON.stringify(JSON.parse(crudo))), limpia);
  } catch {
    return false;
  }
}

/* El ÚNICO evento que se atiende.

   Kapso deja suscribir once —mensaje enviado, leído, entregado, fallido,
   conversación abierta, cerrada...— y el panel los marca todos por omisión.
   El caro es `whatsapp.message.sent`: es el aviso de lo que ACABAMOS de
   mandar, y atenderlo sería contestarse a sí mismo en bucle, pagando cada
   vuelta.

   Se descartan por el nombre del evento y no sólo por `direction: outbound`,
   que es un campo opcional del payload: apoyar un bucle infinito de gasto en
   que un campo venga siempre es apoyarlo en nada. */
const EVENTO_BUENO = 'whatsapp.message.received';

/* Cómo se llama lo que llegó. Un lote lo dice en su sobre; un envío suelto, en
   la cabecera. Del sobre sólo se cree un nombre que parezca de evento — si
   algún día trae un `type` de otra cosa, mejor caer a la cabecera que empezar
   a ignorar todo en silencio. */
function nombreEvento(sobre, cabecera) {
  const delSobre = sobre && typeof sobre.type === 'string' ? sobre.type.trim() : '';
  const crudo = delSobre.startsWith('whatsapp.') ? delSobre : String(cabecera || '').trim();
  return crudo.toLowerCase();
}

/* Un webhook trae un evento, o —si Kapso tiene el buffering puesto— un sobre
   con varios. Se normaliza a lista para no escribir el resto dos veces. */
function eventos(cuerpo) {
  if (cuerpo && cuerpo.batch === true && Array.isArray(cuerpo.data)) return cuerpo.data;
  return cuerpo ? [cuerpo] : [];
}

/* De lo que manda Kapso, lo único que nos sirve. Devuelve null para todo lo
   que no sea un mensaje de texto entrante: audios, imágenes, acuses de
   entrega y demás se ignoran con un 200 para que no los reintente.

   El teléfono puede no venir: Kapso avisa que los identificadores nuevos son
   `business_scoped_user_id`. Por eso se guardan los dos y se decide al
   contestar cuál de los dos campos usa la API. */
function mensajeEntrante(evento) {
  const m = evento && evento.message;
  if (!m || m.type !== 'text') return null;
  if (m.kapso && m.kapso.direction && m.kapso.direction !== 'inbound') return null;

  const texto = String((m.text && m.text.body) || '').slice(0, MAX_LARGO_MENSAJE).trim();
  if (!texto) return null;

  const conversacion = evento.conversation || {};
  const numeroId = String(evento.phone_number_id || conversacion.phone_number_id || '');
  const charla = String(conversacion.id || '');
  if (!numeroId || !charla) return null;

  return {
    id: String(m.id || ''),
    texto,
    numeroId,
    charla,
    telefono: m.from ? String(m.from) : '',
    usuarioId: m.from_user_id ? String(m.from_user_id) : '',
  };
}

/* Manda el texto de vuelta. Devuelve true si WhatsApp lo aceptó.

   `to` para un teléfono y `recipient` para un id de usuario: son dos campos
   distintos de la API y mandar el id en `to` falla en silencio. */
async function contestar(env, entrante, texto) {
  const destino = entrante.telefono
    ? { to: entrante.telefono }
    : { recipient: entrante.usuarioId };

  const r = await fetch(`${API}/${entrante.numeroId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.KAPSO_API_KEY,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...destino,
      type: 'text',
      text: { body: texto.slice(0, MAX_LARGO_RESPUESTA) },
    }),
  });

  if (!r.ok) {
    // El cuerpo del error va al log y nunca a la conversación: describe la
    // configuración de Kapso a quien esté del otro lado.
    console.error('kapso rechazó el envío:', r.status, await r.text().catch(() => ''));
    return false;
  }
  return true;
}

/* Un mensaje, de principio a fin. Corre en waitUntil, así que nadie está
   esperando esta promesa: todo lo que falle tiene que quedar en el log. */
async function atenderMensaje(env, ficha, entrante) {
  const kv = env.CUOTA;

  /* Contra el duplicado. Kapso reintenta si no alcanzamos a contestar 200, y
     ya contestamos 200 antes de empezar — pero un reintento en vuelo, o el
     mismo mensaje llegando por dos webhooks, saldría caro: dos llamadas al
     modelo y dos respuestas a la misma persona.

     KV es de consistencia eventual: dos entregas simultáneas podrían colarse
     las dos. Es el mismo trato que la cuota — esto acota gasto, no es un
     candado. */
  if (kv && entrante.id) {
    const clave = `${ficha.id}:wa:visto:${entrante.id}`;
    if (await kv.get(clave)) return;
    await kv.put(clave, '1', { expirationTtl: VIDA_VISTO });
  }

  const sinCupo = await cupo(kv, ficha.id, `wa:${entrante.charla}`, ficha.topes);
  if (sinCupo) {
    await contestar(env, entrante, sinCupo);
    return;
  }

  /* La sesión. El puente charla→sesión vive en la base y no en KV, y eso no es
     un detalle: KV es de consistencia eventual, y con el puente ahí dos
     mensajes seguidos de la misma persona abrían dos hilos separados —el
     segundo sin memoria del primero—. Medido, no supuesto. El índice único de
     D1 lo resuelve: compiten por insertar, gana uno, los dos siguen ahí. */
  let sesionId;
  try {
    sesionId =
      (await almacen.porCanal(env.DB, ficha.id, 'whatsapp', entrante.charla, VIDA_SESION)) ||
      (await almacen.abrirCanal(env.DB, ficha.id, 'whatsapp', entrante.charla));
    if (!sesionId) throw new Error('no se pudo reclamar la sesión');
  } catch (e) {
    console.error('fallo el almacén al abrir sesión de whatsapp:', e);
    /* Sin base no hay conversación —el historial sale de ahí, nunca de la
       petición— así que aquí se acaba. Pero no en silencio: ya contestamos 200
       y el mensaje quedó marcado como visto, así que si nos callamos la
       persona se queda mirando un chat que nunca se vuelve a mover. */
    await contestar(env, entrante, 'Algo se rompió de mi lado. Daniel te contesta en cuanto lo vea.');
    return;
  }

  // El historial sale de la base, nunca de la petición — igual que en el sitio.
  const previos = await almacen.historial(env.DB, sesionId);
  const mensajes = [...previos, { role: 'user', content: entrante.texto }];
  const hilo = [...previos, { role: 'user', content: entrante.texto }];

  const canal = ficha.whatsapp;
  const ajustes = ficha.ajustes(env);
  const cliente = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: BASE });

  let dicho = '';
  let levantados = [];
  try {
    await almacen.guardar(env.DB, sesionId, 'visitante', entrante.texto);
    const salida = await responder(cliente, {
      sistema: canal.sistema,
      herramientas: canal.herramientas,
      ejecutar: canal.ejecutar,
      ajustes,
      mensajes,
    });
    dicho = salida.texto;
    levantados = salida.avisos;
  } catch (e) {
    console.error('fallo del agente en whatsapp:', e);
    dicho =
      e instanceof Anthropic.RateLimitError
        ? 'Ando saturado ahorita. ¿Me escribes en un minuto?'
        : 'Algo se rompió de mi lado. Daniel te contesta en cuanto lo vea.';
  }

  // Un turno sin una sola letra deja a la persona esperando en un chat que no
  // vuelve a moverse. En el sitio se ve una burbuja vacía; aquí, nada.
  if (!dicho) dicho = 'Esa no la supe contestar. Se la paso a Daniel y te contesta él.';

  // Se guarda ANTES de mandar: si el envío falla, la conversación existe y la
  // ves en la bandeja. Al revés se perdería sin dejar rastro.
  try {
    await almacen.guardar(env.DB, sesionId, 'agente', dicho);
  } catch (e) {
    console.error('no se pudo guardar el turno del agente:', e);
  }

  await contestar(env, entrante, dicho);

  for (const aviso of levantados) {
    await levantarAviso(env, ficha.id, sesionId, aviso, [
      ...hilo,
      { role: 'assistant', content: dicho },
    ]);
  }
}

/* La puerta. Devuelve null si la ruta no es suya —así index.js sigue con lo
   demás— y una Response si sí. */
export async function atender(peticion, env, ruta, contexto) {
  if (ruta !== '/whatsapp') return null;
  if (peticion.method !== 'POST') return new Response('usa POST', { status: 405 });

  /* Sin secreto no hay puerta, y sin puerta esto sería un endpoint público que
     llama al modelo: cualquiera con la URL gastaría la cuota del día. Muerto
     es la postura correcta mientras no esté configurado. El detalle va al log
     y no a la respuesta — nombrar la variable que falta le describe la
     configuración a quien esté tocando. */
  if (!env.KAPSO_WEBHOOK_SECRET || !env.KAPSO_API_KEY) {
    console.error('faltan los secretos KAPSO_WEBHOOK_SECRET / KAPSO_API_KEY');
    return new Response('no disponible', { status: 503 });
  }
  if (!env.DB || !env.DEEPSEEK_API_KEY) {
    console.error('whatsapp: falta DB o DEEPSEEK_API_KEY');
    return new Response('no disponible', { status: 503 });
  }

  const crudo = await peticion.text();
  if (!(await firmaValida(env.KAPSO_WEBHOOK_SECRET, crudo, peticion.headers.get('x-webhook-signature')))) {
    return new Response('firma inválida', { status: 401 });
  }

  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return new Response('cuerpo inválido', { status: 400 });
  }

  /* De aquí en adelante nada puede devolver otra cosa que 200: la firma ya
     dijo que el mensaje es legítimo, y un error nuestro no debe provocar que
     Kapso lo reintente tres veces contra el modelo. */
  /* Si sabemos cómo se llama y no es el nuestro, se acaba aquí: 200 para que
     Kapso no lo reintente, y ni una llamada al modelo. Si NO se puede saber
     —sin cabecera y sin sobre— se sigue, y entonces mandan los filtros de
     contenido de `mensajeEntrante`: es preferible a que el canal se muera
     callado el día que Kapso deje de mandar la cabecera. */
  const nombre = nombreEvento(cuerpo, peticion.headers.get('x-webhook-event'));
  if (nombre && nombre !== EVENTO_BUENO) {
    console.log('whatsapp: evento que no atendemos:', nombre);
    return new Response('ok');
  }

  const cola = [];
  for (const sobre of eventos(cuerpo)) {
    /* Todo lo que se descarta deja línea en el log. Sin esto, un webhook mal
       configurado se ve idéntico a uno que funciona —200 en los dos— y no hay
       forma de saber cuál de los cinco filtros lo tiró. Va al log y nunca a la
       respuesta, y sin el texto ni el teléfono: describir por qué se descartó
       no exige repetir lo que dijo la persona. */
    const entrante = mensajeEntrante(sobre);
    if (!entrante) {
      const m = (sobre && sobre.message) || {};
      const c = (sobre && sobre.conversation) || {};
      console.log(
        'whatsapp: descartado —',
        JSON.stringify({
          evento: nombre || '(sin cabecera)',
          tipo: m.type || '(sin message.type)',
          direccion: (m.kapso && m.kapso.direction) || '(sin direction)',
          hayTexto: Boolean(m.text && m.text.body),
          charla: Boolean(c.id),
          numeroId: sobre && (sobre.phone_number_id || c.phone_number_id) ? 'sí' : 'no',
          llaves: Object.keys(sobre || {}).join(','),
        })
      );
      continue;
    }

    // Quién es el dueño de este número. Mismo papel que el origen en el sitio:
    // si no es de nadie, no se atiende y no se gasta.
    const ficha = porNumeroWhatsapp(entrante.numeroId, env);
    if (!ficha || !ficha.whatsapp) {
      console.log(
        'whatsapp: número no reconocido — llegó ' + entrante.numeroId +
          ', KAPSO_NUMERO_ID tiene ' + (env.KAPSO_NUMERO_ID || '(vacío)')
      );
      continue;
    }

    cola.push([ficha, entrante]);
  }

  /* En orden y de uno en uno, no en paralelo. Un lote de Kapso trae los
     mensajes que la persona escribió seguidos, y contestarlos a la vez deja al
     segundo sin ver el primero en su historial: dos respuestas a media
     conversación, cada una ignorando a la otra. Son dos o tres mensajes por
     sobre; la fila no cuesta nada. */
  if (cola.length) {
    contexto.waitUntil(
      (async () => {
        for (const [ficha, entrante] of cola) {
          try {
            await atenderMensaje(env, ficha, entrante);
          } catch (e) {
            console.error('whatsapp reventó fuera del try:', e);
          }
        }
      })()
    );
  }

  return new Response('ok');
}
