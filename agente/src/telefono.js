/* El telefono de nerv: un numero que contesta y que llama, con Kiyo (el
   agente de la ficha) al otro lado. Arrancado la noche del 2026-09-02 (proyecto 2 del plan maestro).

   Como esta partido:
     · Twilio pone la telefonia, la transcripcion en vivo y la voz. Se usa
       ConversationRelay: Twilio nos abre un WebSocket por llamada, nos manda
       lo que la persona dijo como TEXTO y le mandamos de vuelta TEXTO por
       pedacitos, que Twilio convierte en voz mientras llega. Nosotros ponemos
       solo el cerebro. Manejar audio crudo (mu-law a 8 kHz, VAD, cortes) es
       semanas; esto son tres mensajes JSON.
     · El cerebro es DeepSeek flash en streaming y sin razonamiento oculto: en
       una llamada, dos segundos de silencio y la persona cuelga.
     · Quien habla es el agente de la ficha del cliente (clientes/daniel.js,
       bloque `telefono`): la misma cabeza, el mismo perfil de nerv y las
       mismas guardas que el chat del sitio y WhatsApp, mas un bloque de
       "estas en una llamada". Sus herramientas hacen cosas: avisar a Daniel
       por Telegram, mandar el enlace por SMS al numero que llama, apartar
       llamada. Aqui no vive ni una linea de persona.
     · La voz: Twilio solo integra Google, Amazon y ElevenLabs. Si estan los
       secretos FISH_API_KEY y FISH_VOZ, la voz la pone Fish Audio: generamos
       un mp3 por frase y se lo mandamos a Twilio como `play` (una URL de este
       worker, /telefono/audio/<hash>); Twilio los reproduce en orden. Cada
       frase queda guardada en D1 por su hash, asi que el saludo, que es
       siempre el mismo, sale al instante desde la segunda llamada. Sin esos
       secretos, la voz es la de Twilio (`text`), que hoy es ElevenLabs.
     · Tres puertas, cada una la suya, porque ninguna trae cabecera Origin:
         /telefono/entrante  webhook de Twilio  -> firma X-Twilio-Signature
         /telefono/relay     WebSocket           -> token secreto en la URL,
                                                    que solo viaja dentro del
                                                    TwiML firmado
         /telefono/llamar    salientes           -> el token de la bandeja
     · Todo queda en D1 (tabla `llamadas`, se crea sola). Y antes de marcar
       se consulta `no_llamar`: quien pidio que no le llamen, no recibe otra.

   Lo que NO hace todavia: marcar en frio a listas. La frontera legal (REPEP
   de PROFECO) se resuelve antes de eso, no despues. */

import Anthropic from '@anthropic-ai/sdk';
import { BASE, MAX_VUELTAS_HERRAMIENTA } from './motor.js';
import * as avisos from './avisos.js';
import { todas } from './clientes/index.js';

const MODELO_VOZ = 'deepseek-v4-flash';
const MAX_TURNOS = 40;
// 220 cortaba respuestas a media frase (33, 96 y 265 letras, medido el
// 2026-09-03): el tope se comparte con lo que el modelo piense antes de hablar,
// aunque se le pida esfuerzo `none`. Lo corto lo pone la persona, no el tope.
const MAX_TOKENS_TURNO = 600;

// ── Quien atiende, y que sabe de esta llamada ───────────────────────────
// La ficha que trae bloque `telefono` es la que atiende este numero. Hoy es
// nerv; cuando haya mas numeros se elige por el numero marcado.
const fichaTelefono = () => todas().find((f) => f.telefono) || null;

// Lo que cambia por llamada, pegado al final de la persona de la ficha. El
// numero de la persona NO se le pasa al modelo: lo usan las herramientas.
function contextoLlamada({ direccion, nombre, apodo, saludo }) {
  const quien = nombre ? `Le hablas a ${nombre}.` : 'No sabes con quien hablas todavia: preguntalo con buen modo.';
  const propuesta = apodo
    ? `Ya le hicimos una propuesta de sitio web, terminada y en linea, en nervcenter punto online, diagonal p, diagonal ${apodo}. No es un boceto: se puede abrir ahora mismo. Se la mandas con mandar_enlace.`
    : 'No hay una propuesta preparada para esta persona: no la inventes. Si le interesa un sitio, averigua de que es su negocio y avisale a Daniel.';
  return (
    'ESTA LLAMADA\n' +
    `- ${direccion === 'saliente' ? 'Tu llamaste.' : 'Te llamaron.'} ${quien}\n` +
    `- ${propuesta}\n` +
    '- El numero desde el que habla ya quedo registrado: no se lo pidas. Los mensajes de texto le llegan ahi.\n' +
    (saludo ? `- Ya saludaste con: "${saludo}". No repitas el saludo.\n` : '')
  );
}
const sistema = (ficha, llamada) => ficha.telefono.sistema + '\n\n' + contextoLlamada(llamada);

// El SMS con el que las herramientas cumplen lo que prometen.
async function mandarSms(env, a, texto) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM || !a) return false;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: a, From: env.TWILIO_FROM, Body: texto.slice(0, 320) }),
  });
  if (!r.ok) console.warn('telefono: sms', r.status, (await r.text().catch(() => '')).slice(0, 160));
  else console.log('telefono: sms enviado');
  return r.ok;
}

// ── Twilio: la firma del webhook ────────────────────────────────────────
// Twilio firma: URL completa + (para POST) los campos ordenados por nombre y
// pegados nombre+valor, HMAC-SHA1 con el auth token, en base64.
async function firmaValida(peticion, env, url, campos) {
  const cabecera = peticion.headers.get('x-twilio-signature') || '';
  if (!env.TWILIO_AUTH_TOKEN || !cabecera) return false;
  let datos = url.toString();
  const llaves = [...campos.keys()].sort();
  for (const k of llaves) datos += k + campos.get(k);
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TWILIO_AUTH_TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(datos));
  const esperada = btoa(String.fromCharCode(...new Uint8Array(firma)));
  return igual(esperada, cabecera);
}

function igual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const xml = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// ── D1: tablas que se crean solas ───────────────────────────────────────
let tablasListas = false;
async function asegurarTablas(db) {
  if (tablasListas) return;
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS llamadas (' +
      ' sid TEXT PRIMARY KEY, direccion TEXT, de TEXT, a TEXT, apodo TEXT, nombre TEXT,' +
      ' inicio TEXT NOT NULL, fin TEXT, turnos TEXT, resultado TEXT)'
    ),
    db.prepare('CREATE TABLE IF NOT EXISTS no_llamar (numero TEXT PRIMARY KEY, motivo TEXT, creada TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS audios (clave TEXT PRIMARY KEY, mp3 BLOB NOT NULL, creado TEXT NOT NULL)'),
  ]);
  tablasListas = true;
}

// ── La voz de Fish Audio (opcional) ─────────────────────────────────────
const conFish = (env) => !!(env.FISH_API_KEY && env.FISH_VOZ);
const modeloFish = (env) => env.FISH_MODELO || 's2.1-pro';

// Se corta por frase (punto, pregunta, admiracion seguidos de espacio) para
// que la primera salga a hablar mientras se generan las demas.
const FIN_DE_FRASE = /^([\s\S]*?[.!?…])\s+/;
function partirFrases(texto) {
  const frases = []; let resto = String(texto || '');
  let m;
  while ((m = FIN_DE_FRASE.exec(resto))) { if (m[1].trim()) frases.push(m[1].trim()); resto = resto.slice(m[0].length); }
  if (resto.trim()) frases.push(resto.trim());
  return frases;
}

// La clave lleva el token del relay: sin el nadie puede calcular la URL de un
// audio, aunque sepa el texto. Hash a 40 hex; el mp3 se sirve por esa ruta.
async function claveAudio(env, texto) {
  const datos = new TextEncoder().encode(`${env.TEL_RELAY_TOKEN}|${env.FISH_VOZ}|${modeloFish(env)}|${env.FISH_VELOCIDAD || ''}|${texto}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
  return [...hash.slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL del mp3 de `texto`; lo genera con Fish si no esta guardado. */
async function audioDeFish(env, host, texto, senal) {
  const clave = await claveAudio(env, texto);
  const urlAudio = `https://${host}/telefono/audio/${clave}`;
  await asegurarTablas(env.DB);
  if (await env.DB.prepare('SELECT 1 FROM audios WHERE clave = ?').bind(clave).first()) return urlAudio;

  // Tope de 8 s por frase, ademas de la interrupcion de la persona.
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 8000);
  if (senal) senal.addEventListener('abort', () => control.abort(), { once: true });
  let mp3;
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST', signal: control.signal,
      headers: { authorization: 'Bearer ' + env.FISH_API_KEY, 'content-type': 'application/json', model: modeloFish(env) },
      body: JSON.stringify({
        text: texto, reference_id: env.FISH_VOZ, format: 'mp3', mp3_bitrate: 64, latency: 'balanced', chunk_length: 200,
        normalize: true, prosody: { speed: Number(env.FISH_VELOCIDAD) || 1 },
      }),
    });
    if (!r.ok) throw new Error('fish ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160));
    mp3 = await r.arrayBuffer();
    console.log('telefono: fish', mp3.byteLength, 'bytes en', Date.now() - t0, 'ms para', texto.length, 'letras');
  } finally { clearTimeout(reloj); }
  if (mp3.byteLength < 200 || mp3.byteLength > 900000) throw new Error('fish: mp3 de ' + mp3.byteLength + ' bytes');
  await env.DB.prepare('INSERT OR IGNORE INTO audios (clave, mp3, creado) VALUES (?,?,?)').bind(clave, mp3, new Date().toISOString()).run();
  // De vez en cuando se barren los de mas de dos semanas.
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM audios WHERE creado < ?').bind(new Date(Date.now() - 14 * 864e5).toISOString()).run().catch(() => {});
  return urlAudio;
}

async function audio(env, ruta) {
  const clave = ruta.slice('/telefono/audio/'.length);
  if (!/^[0-9a-f]{40}$/.test(clave)) return new Response('no', { status: 404 });
  const fila = await env.DB.prepare('SELECT mp3 FROM audios WHERE clave = ?').bind(clave).first().catch(() => null);
  if (!fila) return new Response('no', { status: 404 });
  return new Response(fila.mp3, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400' } });
}

// El saludo: el mismo texto para el TwiML (voz de Twilio) y para Fish.
function saludoDe(env, direccion, nombre) {
  if (env.TEL_SALUDO_SALIENTE && direccion === 'saliente') return env.TEL_SALUDO_SALIENTE;
  return direccion === 'saliente'
    ? `Hola, buenas. Habla Kiyo, de nerv. ${nombre ? 'Le llamo por ' + nombre + '. ' : ''}Le hicimos una propuesta de pagina de internet, ya terminada; le quito un minuto nada mas. ¿Se puede?`
    : 'Hola, habla Kiyo, de nerv. ¿En que le puedo ayudar?';
}

const soloDigitos = (n) => String(n || '').replace(/[^\d+]/g, '');

// ── El cerebro, en streaming y con herramientas ─────────────────────────
// Cada pedazo de texto sale en cuanto llega: ConversationRelay empieza a
// hablar con el primero. Cuando el modelo llama una herramienta, se ejecuta
// con la ficha y se le devuelve el resultado en la misma vuelta; lo que dijo
// antes de llamarla ya se oyo. `senal` corta todo si la persona interrumpe.
async function pensarEnVivo(env, ficha, llamada, mensajes, alTexto, alEfecto, senal) {
  const cliente = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: BASE });
  const ajustes = {
    ...ficha.ajustes(env),
    direccion: llamada.direccion,
    numero: llamada.direccion === 'saliente' ? llamada.a : llamada.de,
    propuestaUrl: llamada.apodo ? `https://nervcenter.online/p/${llamada.apodo}` : '',
    sitio: 'https://nervcenter.online',
  };
  const hilo = mensajes.slice();
  let texto = '', pensados = 0, fin = 'sin stop_reason';
  const t0 = Date.now();
  for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTA; vuelta++) {
    const flujo = cliente.messages.stream({
      model: env.MODELO_VOZ || MODELO_VOZ, max_tokens: MAX_TOKENS_TURNO,
      system: sistema(ficha, llamada), tools: ficha.telefono.herramientas, messages: hilo,
      // DeepSeek V4 piensa por defecto con esfuerzo high; al telefono no hay tiempo.
      // `reasoning.effort = none` es lo que documenta DeepSeek para su endpoint
      // Anthropic, pero medido el 2026-09-03 seguia pensando 600-1000 letras por
      // turno (1 a 2 s de silencio). Lo que lo apaga es el `thinking` de Anthropic.
      reasoning: { effort: 'none' },
      thinking: { type: 'disabled' },
    }, { signal: senal });
    flujo.on('text', (delta) => { texto += delta; alTexto(delta); });
    flujo.on('thinking', (delta) => { pensados += String(delta || '').length; });
    const mensaje = await flujo.finalMessage();
    fin = mensaje.stop_reason || fin;
    const usos = mensaje.content.filter((b) => b.type === 'tool_use');
    if (fin === 'end_turn' || !usos.length) break;

    hilo.push({ role: 'assistant', content: mensaje.content });
    const resultados = [];
    for (const uso of usos) {
      const { resultado, aviso, sms } = ficha.telefono.ejecutar(uso.name, uso.input, ajustes);
      console.log('telefono: herramienta', uso.name, aviso ? 'con aviso' : '', sms ? 'con sms' : '');
      if (aviso || sms) alEfecto({ aviso, sms, numero: ajustes.numero });
      resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: resultado });
    }
    hilo.push({ role: 'user', content: resultados });
    // Lo de antes de la herramienta y lo de despues se oyen seguidos: que no se peguen.
    if (texto && !/\s$/.test(texto)) { texto += ' '; alTexto(' '); }
  }
  // Rastro de como termino, para distinguir modelo (stop_reason) de conexion
  // y ver si penso aunque se le pidio que no.
  const cortada = texto.trim() && !/[.!?\u2026\u00bb")]\s*$/.test(texto.trim());
  if (cortada || fin !== 'end_turn' || pensados) console.warn('telefono: respuesta', cortada ? 'CORTADA' : 'completa', 'fin=' + fin, 'penso=' + pensados, texto.length, 'letras en', Date.now() - t0, 'ms:', JSON.stringify(texto.slice(-50)));
  return texto;
}

// ── La llamada, turno por turno, sobre el WebSocket ─────────────────────
function relay(peticion, env, url, contexto) {
  if (peticion.headers.get('upgrade') !== 'websocket') { console.warn('telefono: relay sin upgrade'); return new Response('esperaba websocket', { status: 426 }); }
  if (!env.TEL_RELAY_TOKEN || !igual(url.searchParams.get('t') || '', env.TEL_RELAY_TOKEN)) { console.warn('telefono: relay con token malo'); return new Response('no', { status: 403 }); }
  console.log('telefono: relay conectado');
  if (!env.DEEPSEEK_API_KEY) return new Response('sin cerebro', { status: 503 });
  const ficha = fichaTelefono();
  if (!ficha) { console.error('telefono: ninguna ficha trae bloque telefono'); return new Response('sin agente', { status: 503 }); }

  const par = new WebSocketPair();
  const [cliente, servidor] = [par[0], par[1]];
  servidor.accept();

  const llamada = { sid: null, direccion: 'entrante', de: '', a: '', apodo: '', nombre: '', saludo: '', inicio: new Date().toISOString(), turnos: [], resultado: '' };
  let generando = null;   // AbortController del turno en curso
  let ocupado = false;
  let cerrada = false;

  const enviar = (m) => { try { servidor.send(JSON.stringify(m)); } catch {} };

  // Como habla el agente. Con Fish: cada frase se pide en cuanto esta completa y se
  // manda como `play` EN ORDEN (la cola), aunque las generaciones corran en
  // paralelo. Si Fish falla o tarda mas de 8 s, esa frase la dice la voz de
  // Twilio: una frase con otra voz es mejor que un hueco. Sin Fish: `text`.
  const fish = conFish(env);
  let cola = Promise.resolve();
  const decirFrase = (frase, control) => {
    if (control.signal.aborted) return;
    if (!fish) { enviar({ type: 'text', token: frase, last: false, interruptible: true }); return; }
    const audio = audioDeFish(env, url.host, frase, control.signal).catch((e) => { if (!control.signal.aborted) console.warn('telefono: fish', e && e.message); return null; });
    cola = cola.then(async () => {
      const fuente = await audio;
      if (control.signal.aborted) return;
      if (fuente) enviar({ type: 'play', source: fuente, interruptible: true, preemptible: false });
      else enviar({ type: 'text', token: frase, last: true, interruptible: true });
    });
  };
  // Partidor incremental: recibe pedazos del modelo y suelta frases completas.
  const partidor = (control) => {
    let resto = '';
    return {
      empujar(pedazo) {
        if (!fish) { decirFrase(pedazo, control); return; }
        resto += pedazo;
        let m;
        while ((m = FIN_DE_FRASE.exec(resto))) { const frase = m[1].trim(); resto = resto.slice(m[0].length); if (frase) decirFrase(frase, control); }
        // Una frase larguisima sin punto: se corta en una coma para no esperar a todo.
        if (resto.length > 180) { const corte = resto.lastIndexOf(', '); if (corte > 60) { decirFrase(resto.slice(0, corte + 1).trim(), control); resto = resto.slice(corte + 2); } }
      },
      vaciar() { const f = resto.trim(); resto = ''; if (f) decirFrase(f, control); },
    };
  };
  const cerrarTurno = async (control) => {
    if (control.signal.aborted) return;
    if (fish) await cola; else enviar({ type: 'text', token: '', last: true });
  };

  const guardar = async (fin) => {
    if (!llamada.sid) return;
    try {
      await asegurarTablas(env.DB);
      await env.DB.prepare(
        'INSERT INTO llamadas (sid, direccion, de, a, apodo, nombre, inicio, fin, turnos, resultado) VALUES (?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(sid) DO UPDATE SET fin = excluded.fin, turnos = excluded.turnos, resultado = excluded.resultado'
      ).bind(llamada.sid, llamada.direccion, llamada.de, llamada.a, llamada.apodo, llamada.nombre, llamada.inicio,
             fin ? new Date().toISOString() : null, JSON.stringify(llamada.turnos).slice(0, 60000), llamada.resultado || null).run();
    } catch (e) { console.error('telefono: guardar', e && e.message); }
  };

  // Lo que las herramientas producen: el aviso a Daniel se registra en la
  // llamada (columna `resultado`, que es el registro) y se entrega por
  // Telegram; el SMS sale al numero de la persona. Ninguno detiene la voz.
  const alEfecto = ({ aviso, sms, numero }) => {
    if (aviso) {
      llamada.resultado = (llamada.resultado ? llamada.resultado + ' | ' : '') + aviso.titulo + ': ' + aviso.cuerpo;
      const hilo = llamada.turnos.filter((t) => t.rol !== 'tecla').map((t) => ({ role: t.rol === 'persona' ? 'user' : 'assistant', content: t.texto }));
      contexto.waitUntil(guardar(false).then(() => avisos.porTelegram(env, aviso, hilo)).catch((e) => console.error('telefono: aviso', e && e.message)));
    }
    if (sms) contexto.waitUntil(mandarSms(env, numero, sms).catch((e) => console.error('telefono: sms', e && e.message)));
  };

  async function responder(dicho) {
    if (ocupado && generando) generando.abort();
    ocupado = true;
    const control = new AbortController(); generando = control;
    llamada.turnos.push({ rol: 'persona', texto: dicho, t: Date.now() });
    const mensajes = llamada.turnos.slice(-12).map((t) => ({ role: t.rol === 'persona' ? 'user' : 'assistant', content: t.texto }));
    let dicho_ = '';
    try {
      const boca = partidor(control);
      const alTexto = (pedazo) => { if (!control.signal.aborted) boca.empujar(pedazo); };
      dicho_ = await pensarEnVivo(env, ficha, llamada, mensajes, alTexto, alEfecto, control.signal);
      // El modelo devuelve vacio de vez en cuando (medido: 1 de 3 turnos en la
      // primera prueba). Al telefono un silencio es peor que repetir: se
      // reintenta una vez y, si sigue vacio, una frase que mantiene la llamada.
      if (!dicho_.trim() && !control.signal.aborted) {
        dicho_ = await pensarEnVivo(env, ficha, llamada, mensajes, alTexto, alEfecto, control.signal);
      }
      if (!dicho_.trim() && !control.signal.aborted) {
        dicho_ = 'Perdon, no le escuche bien. ¿Me lo repite?';
        alTexto(dicho_);
      }
      boca.vaciar();
      await cerrarTurno(control);
    } catch (e) {
      if (!control.signal.aborted) {
        console.error('telefono: turno', e && e.message);
        const boca = partidor(control);
        boca.empujar('Perdon, se me fue un segundo. Le decia: si gusta, le mando el enlace por WhatsApp y Daniel le llama con calma. ');
        boca.vaciar();
        await cerrarTurno(control).catch(() => {});
      }
    }
    if (dicho_) llamada.turnos.push({ rol: 'vale', texto: dicho_, t: Date.now(), cortado: control.signal.aborted });
    if (generando === control) { generando = null; ocupado = false; }
    // Quien pide que no le llamen, queda anotado con su numero, no con su nombre.
    if (/no me (vuelvan a )?llam|no (quiero|me interesa) que (me )?llamen|quitenme de/i.test(dicho)) {
      const numero = soloDigitos(llamada.direccion === 'saliente' ? llamada.a : llamada.de);
      if (numero) contexto.waitUntil(asegurarTablas(env.DB).then(() =>
        env.DB.prepare('INSERT OR IGNORE INTO no_llamar (numero, motivo, creada) VALUES (?,?,?)').bind(numero, 'lo pidio en llamada', new Date().toISOString()).run()
      ).catch(() => {}));
    }
    if (llamada.turnos.length >= MAX_TURNOS) { enviar({ type: 'end' }); }
  }

  // Lo que dijo la persona cuando Twilio lo entrega en pedazos (`last: false`):
  // se junta y, si en 700 ms no llega nada mas, se toma por frase completa. En
  // la llamada del 2026-09-03 pasaron 47 s sin un solo turno registrado; el
  // filtro anterior tiraba todo lo que no traia `last: true`.
  let pendiente = '', temporizador = null;
  const soltarPendiente = () => {
    temporizador = null;
    const dicho = pendiente.trim(); pendiente = '';
    if (dicho && !cerrada) contexto.waitUntil(responder(dicho));
  };

  servidor.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    console.log('telefono: <-', m.type, m.type === 'prompt' ? `last=${m.last} "${String(m.voicePrompt || '').slice(0, 80)}"` : m.type === 'error' ? m.description : '');
    if (m.type === 'setup') {
      llamada.sid = m.callSid || m.sessionId || null;
      llamada.de = m.from || ''; llamada.a = m.to || '';
      const p = m.customParameters || {};
      llamada.direccion = p.direccion === 'saliente' ? 'saliente' : 'entrante';
      llamada.apodo = String(p.apodo || '').replace(/[^\w-]/g, '').slice(0, 40);
      llamada.nombre = String(p.nombre || '').slice(0, 80);
      llamada.saludo = String(p.saludo || '').slice(0, 400);
      contexto.waitUntil(guardar(false));
      if (fish && llamada.saludo) {
        const control = new AbortController(); generando = control;
        const boca = partidor(control);
        boca.empujar(llamada.saludo + ' '); boca.vaciar();
        contexto.waitUntil(cerrarTurno(control).then(() => { if (generando === control) generando = null; }));
      }
    } else if (m.type === 'prompt') {
      const trozo = String(m.voicePrompt || '').trim();
      if (!trozo || cerrada) return;
      // Si el pedazo nuevo ya trae lo anterior (parciales acumulados), sustituye; si no, se agrega.
      pendiente = !pendiente || trozo.startsWith(pendiente) ? trozo : pendiente + ' ' + trozo;
      if (temporizador) clearTimeout(temporizador);
      if (m.last === false) { temporizador = setTimeout(soltarPendiente, 700); return; }
      soltarPendiente();
    } else if (m.type === 'interrupt') {
      if (generando) generando.abort();
      const ultimo = llamada.turnos[llamada.turnos.length - 1];
      if (ultimo && ultimo.rol === 'vale') ultimo.oido = String(m.utteranceUntilInterrupt || '').slice(0, 400);
    } else if (m.type === 'dtmf') {
      llamada.turnos.push({ rol: 'tecla', texto: String(m.digit || ''), t: Date.now() });
    } else if (m.type === 'error') {
      console.error('telefono: relay', m.description);
    }
  });
  const cerrar = () => { if (cerrada) return; cerrada = true; if (temporizador) clearTimeout(temporizador); if (generando) generando.abort(); contexto.waitUntil(guardar(true)); };
  servidor.addEventListener('close', cerrar);
  servidor.addEventListener('error', cerrar);

  return new Response(null, { status: 101, webSocket: cliente });
}

// ── El webhook de voz: Twilio pregunta que hacer con la llamada ─────────
async function entrante(peticion, env, url) {
  if (!env.TWILIO_AUTH_TOKEN || !env.TEL_RELAY_TOKEN) return new Response('sin telefono configurado', { status: 503 });
  const campos = new URLSearchParams(await peticion.text());
  if (!(await firmaValida(peticion, env, url, campos))) {
    // Se deja rastro sin el token: cual URL se firmo y cuantos campos vinieron,
    // que es lo que suele no cuadrar (query distinta, token con espacio).
    console.warn('telefono: firma invalida', url.toString(), 'campos:', [...campos.keys()].length, 'cabecera:', (peticion.headers.get('x-twilio-signature') || '').length);
    return new Response('firma invalida', { status: 403 });
  }

  const direccion = url.searchParams.get('direccion') === 'saliente' ? 'saliente' : 'entrante';
  const nombre = (url.searchParams.get('nombre') || '').slice(0, 80);
  const apodo = (url.searchParams.get('apodo') || '').replace(/[^\w-]/g, '').slice(0, 40);
  const saludo = saludoDe(env, direccion, nombre);

  const host = url.host;
  const relayUrl = `wss://${host}/telefono/relay?t=${encodeURIComponent(env.TEL_RELAY_TOKEN)}`;
  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response><Connect>' +
    `<ConversationRelay url="${xml(relayUrl)}" language="es-MX" ttsProvider="${xml(env.TEL_TTS || 'ElevenLabs')}" voice="${xml(env.TEL_VOZ || 'm7yTemJqdIqrcNleANfX')}" ` +
    // La transcripcion por Google: es el unico proveedor del que consta es-MX en Twilio; Deepgram se prueba despues con TEL_STT.
    `transcriptionProvider="${xml(env.TEL_STT || 'Google')}" interruptible="speech" welcomeGreetingInterruptible="speech" dtmfDetection="true" ` +
    // Sin `hints`: el modelo de Google para es-MX no lo soporta (error 64101 de Twilio, medido en la primera llamada).
    // Con Fish el saludo lo dice el relay al conectar, con la voz de Fish; sin Fish lo dice Twilio.
    (conFish(env) ? '' : `welcomeGreeting="${xml(saludo)}" `) + '>' +
    `<Parameter name="direccion" value="${direccion}"/>` +
    (nombre ? `<Parameter name="nombre" value="${xml(nombre)}"/>` : '') +
    (apodo ? `<Parameter name="apodo" value="${xml(apodo)}"/>` : '') +
    `<Parameter name="saludo" value="${xml(saludo)}"/>` +
    '</ConversationRelay></Connect></Response>';
  console.log('telefono: twiml', direccion, 'para', campos.get('To') || campos.get('Called') || '', 'largo', twiml.length);
  return new Response(twiml, { headers: { 'content-type': 'text/xml; charset=utf-8' } });
}

// ── Marcar: una llamada saliente, una a la vez, con el token de la bandeja ──
async function llamar(peticion, env, url, autorizado, contexto) {
  if (!autorizado(peticion, env)) return new Response('no', { status: 403 });
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) return json({ error: 'faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_FROM' }, 503);
  const b = await peticion.json().catch(() => ({}));
  const a = soloDigitos(b.a);
  if (!/^\+\d{10,15}$/.test(a)) return json({ error: 'el numero va en formato internacional, +52...' }, 400);
  await asegurarTablas(env.DB);
  const vetado = await env.DB.prepare('SELECT 1 FROM no_llamar WHERE numero = ?').bind(a).first();
  if (vetado) return json({ error: 'ese numero pidio que no se le llame' }, 409);

  const destino = new URL(`https://${url.host}/telefono/entrante`);
  destino.searchParams.set('direccion', 'saliente');
  if (b.nombre) destino.searchParams.set('nombre', String(b.nombre).slice(0, 80));
  if (b.apodo) destino.searchParams.set('apodo', String(b.apodo).replace(/[^\w-]/g, '').slice(0, 40));

  if (conFish(env)) {
    const saludo = saludoDe(env, 'saliente', String(b.nombre || '').slice(0, 80));
    contexto.waitUntil(Promise.all(partirFrases(saludo).map((f) => audioDeFish(env, url.host, f, null).catch((e) => console.warn('telefono: fish saludo', e && e.message)))));
  }
  const cuerpo = new URLSearchParams({ To: a, From: env.TWILIO_FROM, Url: destino.toString(), Method: 'POST', TimeLimit: String(b.segundos || 300) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' },
    body: cuerpo,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: datos.message || ('twilio ' + r.status) }, 502);
  await env.DB.prepare('INSERT OR IGNORE INTO llamadas (sid, direccion, de, a, apodo, nombre, inicio, turnos) VALUES (?,?,?,?,?,?,?,?)')
    .bind(datos.sid, 'saliente', env.TWILIO_FROM, a, b.apodo || '', b.nombre || '', new Date().toISOString(), '[]').run();
  return json({ ok: true, sid: datos.sid, estado: datos.status });
}

async function noLlamar(peticion, env, autorizado) {
  if (!autorizado(peticion, env)) return new Response('no', { status: 403 });
  const b = await peticion.json().catch(() => ({}));
  const numero = soloDigitos(b.numero);
  if (!numero) return json({ error: 'falta el numero' }, 400);
  await asegurarTablas(env.DB);
  await env.DB.prepare('INSERT OR REPLACE INTO no_llamar (numero, motivo, creada) VALUES (?,?,?)').bind(numero, String(b.motivo || 'lo pidio').slice(0, 120), new Date().toISOString()).run();
  return json({ ok: true });
}

async function ultimas(peticion, env, autorizado) {
  if (!autorizado(peticion, env)) return new Response('no', { status: 403 });
  await asegurarTablas(env.DB);
  const r = await env.DB.prepare('SELECT sid, direccion, de, a, apodo, nombre, inicio, fin, turnos, resultado FROM llamadas ORDER BY inicio DESC LIMIT 30').all();
  return json({ llamadas: r.results.map((l) => ({ ...l, turnos: JSON.parse(l.turnos || '[]') })) });
}

// Diagnostico: lo que Twilio sabe del numero y de las ultimas llamadas, para
// no adivinar cuando "solo marca y cuelga". Con el token de la bandeja.
async function diagnostico(peticion, env, autorizado) {
  if (!autorizado(peticion, env)) return new Response('no', { status: 403 });
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return json({ error: 'sin credenciales de Twilio' }, 503);
  const auth = { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
  const pedir = async (ruta) => { const r = await fetch(base + ruta, { headers: auth }); return { estado: r.status, datos: await r.json().catch(() => ({})) }; };
  const [cuenta, numeros, verificados, llamadas] = await Promise.all([
    pedir('.json'), pedir('/IncomingPhoneNumbers.json?PageSize=5'), pedir('/OutgoingCallerIds.json?PageSize=5'), pedir('/Calls.json?PageSize=8'),
  ]);
  // Las alertas de Twilio por llamada: el codigo y el texto de lo que fallo
  // (TwiML invalido, webhook con error, el WebSocket que no conecto...).
  const alertas = {};
  try {
    const r = await fetch('https://monitor.twilio.com/v1/Alerts?PageSize=20', { headers: auth });
    const d = await r.json().catch(() => ({}));
    for (const a of (d.alerts || [])) {
      const sid = a.resource_sid || '';
      (alertas[sid] = alertas[sid] || []).push({ codigo: a.error_code, nivel: a.log_level, texto: String(a.alert_text || '').slice(0, 300), cuando: a.date_created });
    }
  } catch (e) { console.error('telefono: alertas', e && e.message); }
  return json({
    cuenta: { estado: cuenta.estado, tipo: cuenta.datos.type, status: cuenta.datos.status },
    numeros: (numeros.datos.incoming_phone_numbers || []).map((n) => ({ numero: n.phone_number, voz: n.capabilities && n.capabilities.voice, voiceUrl: n.voice_url, metodo: n.voice_method, estado: n.status })),
    verificados: (verificados.datos.outgoing_caller_ids || []).map((v) => v.phone_number),
    llamadas: (llamadas.datos.calls || []).map((c) => ({ sid: c.sid, de: c.from, a: c.to, direccion: c.direction, estado: c.status, inicio: c.start_time, duracion: c.duration, precio: c.price, alertas: alertas[c.sid] || [] })),
    desde: env.TWILIO_FROM,
    voz: conFish(env)
      ? { motor: 'Fish Audio', voz: env.FISH_VOZ, modelo: modeloFish(env) }
      : { motor: env.TEL_TTS || 'ElevenLabs', voz: env.TEL_VOZ || 'm7yTemJqdIqrcNleANfX' },
  });
}

function json(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Entrada unica. Va ANTES del control de origen: Twilio no manda Origin. */
export async function atender(peticion, env, ruta, contexto, autorizado) {
  if (!ruta.startsWith('/telefono/')) return null;
  const url = new URL(peticion.url);
  if (ruta === '/telefono/entrante' && peticion.method === 'POST') return entrante(peticion, env, url);
  if (ruta === '/telefono/relay') return relay(peticion, env, url, contexto);
  if (ruta === '/telefono/llamar' && peticion.method === 'POST') return llamar(peticion, env, url, autorizado, contexto);
  if (ruta.startsWith('/telefono/audio/') && (peticion.method === 'GET' || peticion.method === 'HEAD')) return audio(env, ruta);
  if (ruta === '/telefono/no-llamar' && peticion.method === 'POST') return noLlamar(peticion, env, autorizado);
  if (ruta === '/telefono/llamadas' && peticion.method === 'GET') return ultimas(peticion, env, autorizado);
  if (ruta === '/telefono/diagnostico' && peticion.method === 'GET') return diagnostico(peticion, env, autorizado);
  return new Response('no existe', { status: 404 });
}
