/* El telefono de nerv: un numero que contesta y que llama, con Vale al otro
   lado. Arrancado la noche del 2026-09-02 (proyecto 2 del plan maestro).

   Como esta partido:
     · Twilio pone la telefonia, la transcripcion en vivo y la voz. Se usa
       ConversationRelay: Twilio nos abre un WebSocket por llamada, nos manda
       lo que la persona dijo como TEXTO y le mandamos de vuelta TEXTO por
       pedacitos, que Twilio convierte en voz mientras llega. Nosotros ponemos
       solo el cerebro. Manejar audio crudo (mu-law a 8 kHz, VAD, cortes) es
       semanas; esto son tres mensajes JSON.
     · El cerebro es DeepSeek flash en streaming y sin razonamiento oculto: en
       una llamada, dos segundos de silencio y la persona cuelga.
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

const MODELO_VOZ = 'deepseek-v4-flash';
const MAX_TURNOS = 40;
const MAX_TOKENS_TURNO = 220;

// ── Persona al telefono ─────────────────────────────────────────────────
// Corta a proposito: al telefono se habla en frases de una linea. Nada de
// listas, ni simbolos, ni cifras con signo: se dicen con palabras.
function sistema({ direccion, nombre, apodo, saludo }) {
  const quien = nombre ? `Le hablas a ${nombre}.` : 'No sabes con quien hablas todavia: preguntalo con buen modo.';
  const propuesta = apodo
    ? `Ya le hicimos una propuesta de sitio web, terminada y en linea, en nervcenter punto online, diagonal p, diagonal ${apodo}. No es un boceto: se puede abrir ahora mismo. Se la puedes mandar por WhatsApp o correo si te da el dato.`
    : 'No hay una propuesta preparada para esta persona; si le interesa un sitio, toma sus datos y ofrece que Daniel le llame.';
  return (
    'Eres Vale, la asistente de nerv, un estudio de Monterrey que hace sitios web a la medida con un ' +
    'agente que contesta a los clientes, integrado. Estas EN UNA LLAMADA TELEFONICA: lo que escribas ' +
    'se convierte en voz al instante.\n\n' +
    `Direccion de la llamada: ${direccion === 'saliente' ? 'tu llamaste' : 'te llamaron'}. ${quien} ${propuesta}\n\n` +
    'Como hablas:\n' +
    '- Frases cortas, una o dos por turno. Espanol de Mexico, de usted, natural, sin sonar a grabacion.\n' +
    '- Nunca listas, ni asteriscos, ni simbolos: los numeros se dicen con palabras ("dos mil pesos").\n' +
    '- Si te interrumpen, dejas lo que decias y atiendes lo nuevo.\n' +
    '- Si la persona esta ocupada o no le interesa, agradeces y te despides en una frase. No insistes.\n' +
    '- Si piden que no se les llame, lo aceptas de inmediato, dices que queda registrado y te despides.\n' +
    '- No inventas precios, plazos ni nombres. Precios y alcance los da Daniel en una cita; tu ofreces ' +
    'agendar esa cita o mandar el enlace.\n' +
    '- No prometes nada que no este en este texto. Amable no es complaciente.\n' +
    (saludo ? `\nYa saludaste con: "${saludo}". No repitas el saludo.\n` : '')
  );
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
  ]);
  tablasListas = true;
}

const soloDigitos = (n) => String(n || '').replace(/[^\d+]/g, '');

// ── El cerebro, en streaming ────────────────────────────────────────────
// Se manda cada pedazo en cuanto llega: ConversationRelay empieza a hablar
// con el primero. `senal` corta la generacion si la persona interrumpe.
async function pensarEnVivo(env, sistemaTexto, mensajes, alTexto, senal) {
  const r = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    signal: senal,
    headers: { 'x-api-key': env.DEEPSEEK_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.MODELO_VOZ || MODELO_VOZ, max_tokens: MAX_TOKENS_TURNO, stream: true,
      // DeepSeek V4 piensa por defecto con esfuerzo high; al telefono no hay tiempo.
      reasoning: { effort: 'none' },
      system: sistemaTexto, messages: mensajes,
    }),
  });
  if (!r.ok || !r.body) {
    const detalle = await r.text().catch(() => '');
    console.error('telefono: deepseek', r.status, detalle.slice(0, 200));
    throw new Error('modelo ' + r.status);
  }
  const lector = r.body.getReader();
  const dec = new TextDecoder();
  let resto = '', texto = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const lineas = resto.split('\n'); resto = lineas.pop();
    for (const l of lineas) {
      if (!l.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(l.slice(5).trim()); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) {
        texto += ev.delta.text;
        alTexto(ev.delta.text);
      }
    }
  }
  return texto;
}

// ── La llamada, turno por turno, sobre el WebSocket ─────────────────────
function relay(peticion, env, url, contexto) {
  if (peticion.headers.get('upgrade') !== 'websocket') return new Response('esperaba websocket', { status: 426 });
  if (!env.TEL_RELAY_TOKEN || !igual(url.searchParams.get('t') || '', env.TEL_RELAY_TOKEN)) return new Response('no', { status: 403 });
  if (!env.DEEPSEEK_API_KEY) return new Response('sin cerebro', { status: 503 });

  const par = new WebSocketPair();
  const [cliente, servidor] = [par[0], par[1]];
  servidor.accept();

  const llamada = { sid: null, direccion: 'entrante', de: '', a: '', apodo: '', nombre: '', saludo: '', inicio: new Date().toISOString(), turnos: [] };
  let generando = null;   // AbortController del turno en curso
  let ocupado = false;
  let cerrada = false;

  const enviar = (m) => { try { servidor.send(JSON.stringify(m)); } catch {} };
  const guardar = async (fin) => {
    if (!llamada.sid) return;
    try {
      await asegurarTablas(env.DB);
      await env.DB.prepare(
        'INSERT INTO llamadas (sid, direccion, de, a, apodo, nombre, inicio, fin, turnos) VALUES (?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(sid) DO UPDATE SET fin = excluded.fin, turnos = excluded.turnos'
      ).bind(llamada.sid, llamada.direccion, llamada.de, llamada.a, llamada.apodo, llamada.nombre, llamada.inicio,
             fin ? new Date().toISOString() : null, JSON.stringify(llamada.turnos).slice(0, 60000)).run();
    } catch (e) { console.error('telefono: guardar', e && e.message); }
  };

  async function responder(dicho) {
    if (ocupado && generando) generando.abort();
    ocupado = true;
    const control = new AbortController(); generando = control;
    llamada.turnos.push({ rol: 'persona', texto: dicho, t: Date.now() });
    const mensajes = llamada.turnos.slice(-12).map((t) => ({ role: t.rol === 'persona' ? 'user' : 'assistant', content: t.texto }));
    let dicho_ = '';
    try {
      const alTexto = (pedazo) => {
        if (control.signal.aborted) return;
        enviar({ type: 'text', token: pedazo, last: false, interruptible: true });
      };
      dicho_ = await pensarEnVivo(env, sistema(llamada), mensajes, alTexto, control.signal);
      // El modelo devuelve vacio de vez en cuando (medido: 1 de 3 turnos en la
      // primera prueba). Al telefono un silencio es peor que repetir: se
      // reintenta una vez y, si sigue vacio, una frase que mantiene la llamada.
      if (!dicho_.trim() && !control.signal.aborted) {
        dicho_ = await pensarEnVivo(env, sistema(llamada), mensajes, alTexto, control.signal);
      }
      if (!dicho_.trim() && !control.signal.aborted) {
        dicho_ = 'Perdon, no le escuche bien. ¿Me lo repite?';
        alTexto(dicho_);
      }
      if (!control.signal.aborted) enviar({ type: 'text', token: '', last: true });
    } catch (e) {
      if (!control.signal.aborted) {
        console.error('telefono: turno', e && e.message);
        enviar({ type: 'text', token: 'Perdon, se me fue un segundo. Le decia: ', last: false });
        enviar({ type: 'text', token: 'si gusta, le mando el enlace por WhatsApp y Daniel le llama con calma.', last: true });
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

  servidor.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'setup') {
      llamada.sid = m.callSid || m.sessionId || null;
      llamada.de = m.from || ''; llamada.a = m.to || '';
      const p = m.customParameters || {};
      llamada.direccion = p.direccion === 'saliente' ? 'saliente' : 'entrante';
      llamada.apodo = String(p.apodo || '').replace(/[^\w-]/g, '').slice(0, 40);
      llamada.nombre = String(p.nombre || '').slice(0, 80);
      llamada.saludo = String(p.saludo || '').slice(0, 200);
      contexto.waitUntil(guardar(false));
    } else if (m.type === 'prompt') {
      if (m.last === false) return;                 // parcial: se espera la frase completa
      const dicho = String(m.voicePrompt || '').trim();
      if (dicho) contexto.waitUntil(responder(dicho));
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
  const cerrar = () => { if (cerrada) return; cerrada = true; if (generando) generando.abort(); contexto.waitUntil(guardar(true)); };
  servidor.addEventListener('close', cerrar);
  servidor.addEventListener('error', cerrar);

  return new Response(null, { status: 101, webSocket: cliente });
}

// ── El webhook de voz: Twilio pregunta que hacer con la llamada ─────────
async function entrante(peticion, env, url) {
  if (!env.TWILIO_AUTH_TOKEN || !env.TEL_RELAY_TOKEN) return new Response('sin telefono configurado', { status: 503 });
  const campos = new URLSearchParams(await peticion.text());
  if (!(await firmaValida(peticion, env, url, campos))) return new Response('firma invalida', { status: 403 });

  const direccion = url.searchParams.get('direccion') === 'saliente' ? 'saliente' : 'entrante';
  const nombre = (url.searchParams.get('nombre') || '').slice(0, 80);
  const apodo = (url.searchParams.get('apodo') || '').replace(/[^\w-]/g, '').slice(0, 40);
  const saludo = env.TEL_SALUDO_SALIENTE && direccion === 'saliente'
    ? env.TEL_SALUDO_SALIENTE
    : direccion === 'saliente'
      ? `Hola, buenas. Habla Vale, de nerv, en Monterrey. ${nombre ? 'Le llamo por ' + nombre + '. ' : ''}Le hicimos una propuesta de pagina de internet, ya terminada; le quito un minuto nada mas. ¿Se puede?`
      : 'Hola, habla Vale, de nerv. ¿En que le puedo ayudar?';

  const host = url.host;
  const relayUrl = `wss://${host}/telefono/relay?t=${encodeURIComponent(env.TEL_RELAY_TOKEN)}`;
  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response><Connect>' +
    `<ConversationRelay url="${xml(relayUrl)}" language="es-MX" ttsProvider="${xml(env.TEL_TTS || 'Amazon')}" voice="${xml(env.TEL_VOZ || 'Mia-Generative')}" ` +
    'transcriptionProvider="Deepgram" interruptible="speech" welcomeGreetingInterruptible="speech" dtmfDetection="true" ' +
    `welcomeGreeting="${xml(saludo)}" hints="nerv, Vale, sitio web, pagina, propuesta, Monterrey, Daniel">` +
    `<Parameter name="direccion" value="${direccion}"/>` +
    (nombre ? `<Parameter name="nombre" value="${xml(nombre)}"/>` : '') +
    (apodo ? `<Parameter name="apodo" value="${xml(apodo)}"/>` : '') +
    `<Parameter name="saludo" value="${xml(saludo)}"/>` +
    '</ConversationRelay></Connect></Response>';
  return new Response(twiml, { headers: { 'content-type': 'text/xml; charset=utf-8' } });
}

// ── Marcar: una llamada saliente, una a la vez, con el token de la bandeja ──
async function llamar(peticion, env, url, autorizado) {
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
  const r = await env.DB.prepare('SELECT sid, direccion, de, a, apodo, nombre, inicio, fin, turnos FROM llamadas ORDER BY inicio DESC LIMIT 30').all();
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
  return json({
    cuenta: { estado: cuenta.estado, tipo: cuenta.datos.type, status: cuenta.datos.status },
    numeros: (numeros.datos.incoming_phone_numbers || []).map((n) => ({ numero: n.phone_number, voz: n.capabilities && n.capabilities.voice, voiceUrl: n.voice_url, metodo: n.voice_method, estado: n.status })),
    verificados: (verificados.datos.outgoing_caller_ids || []).map((v) => v.phone_number),
    llamadas: (llamadas.datos.calls || []).map((c) => ({ sid: c.sid, de: c.from, a: c.to, direccion: c.direction, estado: c.status, inicio: c.start_time, duracion: c.duration, precio: c.price })),
    desde: env.TWILIO_FROM,
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
  if (ruta === '/telefono/llamar' && peticion.method === 'POST') return llamar(peticion, env, url, autorizado);
  if (ruta === '/telefono/no-llamar' && peticion.method === 'POST') return noLlamar(peticion, env, autorizado);
  if (ruta === '/telefono/llamadas' && peticion.method === 'GET') return ultimas(peticion, env, autorizado);
  if (ruta === '/telefono/diagnostico' && peticion.method === 'GET') return diagnostico(peticion, env, autorizado);
  return new Response('no existe', { status: 404 });
}
