/* El tablero: dónde ves de un vistazo qué está corriendo y qué está roto.

   La bandeja te enseña conversaciones — una a una, y sólo cuando la abres. Eso
   sirve para leer a un lead, no para saber si la máquina está viva. Esto es lo
   otro: el estado de los guardias, lo que encontraron, la cuota del día, y el
   correo frío.

   Va montado en el worker y detrás del MISMO token de la bandeja, a propósito.
   Una puerta nueva en un endpoint público es superficie nueva de autenticación,
   y ésas se abren una vez y se quedan abiertas. Comparte hasta la clave de
   localStorage: si ya entraste a la bandeja, ya entraste aquí.

   Ninguna consulta de aquí toca la API del modelo. El tablero es de lectura y
   cuesta cero. */

import { todas } from './clientes/index.js';
import * as propuestas from './propuestas.js';

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function hace(horas) {
  return new Date(Date.now() - horas * 3600 * 1000).toISOString();
}

/* Los números del día, de todas las fuentes a la vez.

   Cada bloque va en su propio try: si Resend se cae o KV tarda, el tablero
   tiene que seguir enseñando lo demás. Un tablero que se pone en blanco entero
   porque una fuente falló es peor que uno con un hueco — el hueco se ve. */
export async function datos(env) {
  const salida = { cuando: new Date().toISOString(), fuentes: {} };

  // ── los guardias ─────────────────────────────────────────────────────────
  try {
    const ultima = await env.DB
      .prepare('SELECT cuando, hallazgos FROM vigilancia ORDER BY id DESC LIMIT 1')
      .first();
    const semana = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM vigilancia WHERE cuando > ?')
      .bind(hace(24 * 7))
      .first();
    salida.vigilancia = ultima
      ? {
          cuando: ultima.cuando,
          hallazgos: JSON.parse(ultima.hallazgos || '[]'),
          corridasSemana: semana ? semana.n : 0,
        }
      : null;   // null = nunca corrió, que NO es lo mismo que "limpio"
  } catch (e) {
    salida.fuentes.vigilancia = String(e);
  }

  // ── conversaciones y leads ───────────────────────────────────────────────
  salida.clientes = [];
  for (const ficha of todas()) {
    const c = { id: ficha.id, nombre: ficha.nombre };
    try {
      const s = await env.DB
        .prepare(
          'SELECT COUNT(*) AS total, ' +
          'SUM(CASE WHEN vista > ? THEN 1 ELSE 0 END) AS dia ' +
          'FROM sesiones WHERE cliente = ?'
        )
        .bind(hace(24), ficha.id)
        .first();
      c.sesiones = s ? s.total : 0;
      c.sesionesDia = s ? s.dia || 0 : 0;

      const sinAtender = await env.DB
        .prepare(
          'SELECT COUNT(*) AS n FROM sesiones s WHERE s.cliente = ? AND s.atendida = 0 ' +
          'AND EXISTS (SELECT 1 FROM avisos a WHERE a.sesion = s.id)'
        )
        .bind(ficha.id)
        .first();
      c.leadsSinAbrir = sinAtender ? sinAtender.n : 0;

      // Un aviso en 0 es un lead que existió y NO te llegó. Es la cifra más
      // cara del tablero: significa que alguien te buscó y no te enteraste.
      const perdidos = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM avisos WHERE cliente = ? AND entregado = 0')
        .bind(ficha.id)
        .first();
      c.avisosSinEntregar = perdidos ? perdidos.n : 0;
    } catch (e) {
      c.error = String(e);
    }

    // ── cuota ──────────────────────────────────────────────────────────────
    try {
      const usado = Number(await env.CUOTA?.get(`${ficha.id}:total:${hoy()}`)) || 0;
      c.cuota = { usado, tope: ficha.topes.global, porIp: ficha.topes.porIp };
    } catch (e) {
      c.cuota = null;
    }

    salida.clientes.push(c);
  }

  // ── propuestas ───────────────────────────────────────────────────────────
  /* Quien esta mirando su propuesta. La cifra util NO es cuantas se generaron
     —eso es trabajo, no resultado— sino cuantas se abrieron y hace cuanto. */
  try {
    salida.propuestas = await propuestas.paraTablero(env.DB);
  } catch (e) {
    salida.fuentes.propuestas = String(e);
  }

  // ── correo frío ──────────────────────────────────────────────────────────
  /* Sin la llave no se inventa un cero: se dice que no está configurado. Un
     "0 rebotes" que en realidad significa "no miré" es peor que un hueco. */
  if (!env.RESEND_API_KEY) {
    salida.correo = { configurado: false };
  } else {
    try {
      const r = await fetch('https://api.resend.com/emails?limit=100', {
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`resend respondió ${r.status}`);
      const d = await r.json();
      const lista = d.data || d.emails || [];
      const cuenta = { enviados: lista.length, entregados: 0, rebotados: 0, abiertos: 0 };
      const malos = [];
      for (const e of lista) {
        const estado = String(e.last_event || e.status || '');
        if (['bounced', 'complained', 'failed'].includes(estado)) {
          cuenta.rebotados++;
          malos.push({ a: (e.to && e.to[0]) || '?', estado });
        } else if (estado === 'delivered') cuenta.entregados++;
        else if (estado === 'opened' || estado === 'clicked') {
          cuenta.entregados++;
          cuenta.abiertos++;
        }
      }
      /* ¿Los "0 abiertos" significan que nadie abrió, o que no estamos
         midiendo? Resend trae el rastreo de apertura APAGADO por defecto, y
         con él apagado un correo leído se queda en `delivered` para siempre.

         Sin esta consulta, el tablero enseñaría un 0 que parece un veredicto
         sobre el mensaje cuando en realidad es un hueco en el instrumento. Es
         la misma regla que arriba: un cero que significa "no miré" es peor que
         decir que no miraste. */
      try {
        const rd = await fetch('https://api.resend.com/domains', {
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}` },
          signal: AbortSignal.timeout(10000),
        });
        if (rd.ok) {
          const dd = await rd.json();
          const dominios = dd.data || [];
          cuenta.rastreaAperturas = dominios.some((x) => x.open_tracking === true);
        }
      } catch {
        // Se queda undefined: "no sé", que es distinto de true y de false.
      }

      salida.correo = { configurado: true, ...cuenta, malos: malos.slice(0, 20) };
    } catch (e) {
      salida.correo = { configurado: true, error: String(e) };
    }
  }

  return salida;
}

export const PAGINA = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Tablero</title>
<style>
:root{--g:#0d1215;--p:#141b1f;--l:#2a363b;--t:#dfe5e7;--d:#9ba8ad;--a:#5fb6ce;--w:#d2a93f;--x:#d2603f}
*{box-sizing:border-box}
body{margin:0;background:var(--g);color:var(--t);font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
header{border-bottom:2px solid var(--l);padding:14px 18px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
h1{font-size:13px;letter-spacing:.18em;text-transform:uppercase;margin:0;color:var(--a)}
header .d{color:var(--d);font-size:12px}
header nav{margin-left:auto;display:flex;gap:10px}
a{color:var(--a)}
button{background:var(--p);color:var(--t);border:1px solid var(--l);padding:6px 9px;font:inherit;
  border-radius:0;cursor:pointer}
button:hover{border-color:var(--a)}
button:focus-visible{outline:2px solid var(--a);outline-offset:2px}
button[disabled]{opacity:.5;cursor:default}
main{padding:18px;display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));
  align-items:start;max-width:1400px}
section{border:1px solid var(--l);padding:0}
section>h2{font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin:0;color:var(--d);
  padding:9px 13px;border-bottom:1px solid var(--l);background:var(--p)}
section>div{padding:13px}
.cifras{display:flex;flex-wrap:wrap;gap:18px;margin:0 0 4px}
.c{min-width:70px}
.c b{display:block;font-size:26px;font-weight:400;line-height:1.1;font-variant-numeric:tabular-nums}
.c span{color:var(--d);font-size:11px;letter-spacing:.09em;text-transform:uppercase}
.c.mal b{color:var(--x)} .c.ojo b{color:var(--w)} .c.bien b{color:var(--a)}
ul{margin:8px 0 0;padding:0;list-style:none}
li{border-left:3px solid var(--w);padding:5px 0 5px 10px;margin:0 0 7px;color:var(--w)}
li.grave{border-color:var(--x);color:var(--x)}
.ok{color:var(--a)}
.nada{color:var(--d)}
.barra{height:6px;background:var(--l);margin:9px 0 3px}
.barra i{display:block;height:100%;background:var(--a)}
.barra i.ojo{background:var(--w)} .barra i.mal{background:var(--x)}
table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:3px 0;border-bottom:1px solid var(--l)}
td:last-child{text-align:right;color:var(--d);font-variant-numeric:tabular-nums}
#puerta{position:fixed;inset:0;background:var(--g);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;padding:24px}
#puerta[hidden]{display:none}
#puerta label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--a)}
#puerta input,#puerta button{background:var(--p);color:var(--t);border:1px solid var(--l);
  padding:9px 11px;font:inherit;border-radius:0;width:min(340px,90vw)}
#puerta input:focus-visible{outline:2px solid var(--a);outline-offset:2px}
#mal{color:var(--w);margin:0;font-size:12px}
#mal[hidden]{display:none}
</style></head><body>

<header>
  <h1>Tablero</h1>
  <span class="d" id="sello">—</span>
  <nav>
    <button id="revisar">Revisar ahora</button>
    <button id="recargar">Recargar</button>
    <a href="/bandeja">bandeja &rarr;</a>
  </nav>
</header>

<main id="cuerpo"></main>

<div id="puerta" hidden>
  <label for="clave">Token de la bandeja</label>
  <input id="clave" type="password" autocomplete="current-password">
  <button id="entrar">Entrar</button>
  <p id="mal" hidden>Ese token no es.</p>
</div>

<script>
// Misma clave que la bandeja: una sola puerta, un solo token.
var token = localStorage.getItem('bandeja') || '';

function api(ruta, opciones) {
  opciones = opciones || {};
  opciones.headers = { authorization: 'Bearer ' + token };
  return fetch(ruta, opciones);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function haceCuanto(iso) {
  if (!iso) return 'nunca';
  var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return 'hace ' + m + ' min';
  var h = Math.round(m / 60);
  if (h < 48) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' d';
}

function cifra(n, etiqueta, clase) {
  return '<div class="c ' + (clase || '') + '"><b>' + esc(n) + '</b><span>' +
         esc(etiqueta) + '</span></div>';
}

function seccion(titulo, dentro) {
  return '<section><h2>' + esc(titulo) + '</h2><div>' + dentro + '</div></section>';
}

/* Un hallazgo se pinta grave si nombra una fuga o el control de origen. No es
   cosmético: son las dos cosas que, si se rompen, no se ven desde el sitio. */
function grave(t) {
  return /FUGA|control de origen|sin entregar/i.test(t);
}

function pintarVigilancia(v) {
  if (!v) {
    return seccion('Guardias',
      '<p class="nada">El vigilante <b>nunca ha corrido</b>. Eso no es "todo limpio":' +
      ' es que nadie ha mirado.</p>');
  }
  var h = v.hallazgos || [];
  var dentro = '<div class="cifras">' +
    cifra(h.length, 'hallazgos', h.length ? 'mal' : 'bien') +
    cifra(v.corridasSemana, 'corridas / 7 d', 'bien') +
    '</div><p class="d">Última revisión ' + esc(haceCuanto(v.cuando)) + '.</p>';
  if (h.length) {
    dentro += '<ul>' + h.map(function (x) {
      return '<li class="' + (grave(x) ? 'grave' : '') + '">' + esc(x) + '</li>';
    }).join('') + '</ul>';
  } else {
    dentro += '<p class="ok">Todo cuadra.</p>';
  }
  return seccion('Guardias', dentro);
}

function pintarCliente(c) {
  var cuota = c.cuota || { usado: 0, tope: 1 };
  var pct = Math.min(100, Math.round((cuota.usado / (cuota.tope || 1)) * 100));
  var clase = pct >= 90 ? 'mal' : pct >= 60 ? 'ojo' : '';
  var dentro = '<div class="cifras">' +
    cifra(c.sesionesDia, 'conversaciones hoy') +
    cifra(c.leadsSinAbrir, 'leads sin abrir', c.leadsSinAbrir ? 'ojo' : '') +
    cifra(c.avisosSinEntregar, 'avisos perdidos', c.avisosSinEntregar ? 'mal' : '') +
    '</div>' +
    '<div class="barra"><i class="' + clase + '" style="width:' + pct + '%"></i></div>' +
    '<p class="d">' + esc(cuota.usado) + ' de ' + esc(cuota.tope) +
    ' mensajes del día (' + pct + '%), tope por IP ' + esc(cuota.porIp) + '.</p>' +
    '<p class="d">' + esc(c.sesiones) + ' conversaciones en total.</p>';
  return seccion(c.nombre || c.id, dentro);
}

function pintarCorreo(m) {
  if (!m) return '';
  if (!m.configurado) {
    return seccion('Correo frío',
      '<p class="nada">Sin <code>RESEND_API_KEY</code> en el worker. Los rebotes de la' +
      ' tanda fría no se pueden revisar solos — hay que abrir el panel a mano.</p>');
  }
  if (m.error) {
    return seccion('Correo frío', '<p class="nada">' + esc(m.error) + '</p>');
  }
  // Si el rastreo está apagado, "abiertos" no es un número: es un hueco. Se
  // pinta como hueco, porque un 0 ahí se lee como veredicto sobre el mensaje.
  var abiertos = m.rastreaAperturas === false
    ? cifra('—', 'abiertos: sin medir')
    : cifra(m.abiertos, 'abiertos', m.abiertos ? 'bien' : '');

  var dentro = '<div class="cifras">' +
    cifra(m.enviados, 'enviados') +
    cifra(m.entregados, 'entregados', 'bien') +
    cifra(m.rebotados, 'rebotados', m.rebotados ? 'mal' : '') +
    abiertos +
    '</div>';

  if (m.rastreaAperturas === false) {
    dentro += '<p class="nada">El rastreo de apertura está <b>apagado</b> en Resend' +
      ' (viene así por defecto). Los entregados pueden haberse leído todos y aquí' +
      ' no se vería. Resend recomienda dejarlo apagado en correo que no es' +
      ' campaña: el pixel de rastreo es señal de marketing.</p>';
  }
  if (m.malos && m.malos.length) {
    dentro += '<table>' + m.malos.map(function (x) {
      return '<tr><td>' + esc(x.a) + '</td><td>' + esc(x.estado) + '</td></tr>';
    }).join('') + '</table>';
  }
  return seccion('Correo frío', dentro);
}

function pintarPropuestas(p) {
  if (!p || !p.abiertas) {
    return seccion('Propuestas',
      '<p class="nada">Nadie ha abierto una propuesta todavia. En cuanto ' +
      'alguien la abra por primera vez te llega aviso por Telegram: es el ' +
      'momento mas caliente que va a tener ese prospecto.</p>');
  }
  var dentro = cifra(p.abiertas, 'abiertas') + cifra(p.lecturas, 'lecturas');
  dentro += '<table>' + (p.recientes || []).map(function (v) {
    return '<tr><td><a href="https://nervcenter.online/p/' + esc(v.apodo) +
      '/">' + esc(v.apodo) + '</a></td><td>' + esc(v.veces) +
      '</td><td>' + esc(haceCuanto(v.ultima)) + '</td></tr>';
  }).join('') + '</table>';
  return seccion('Propuestas', dentro);
}

/* El telefono: se pide aparte porque consulta a Twilio y tarda; el resto del
   tablero no espera por el. */
function pintarTelefono(dg, ll) {
  if (dg && dg.error) return seccion('Teléfono', '<p class="nada">' + esc(dg.error) + '</p>');
  var num = (dg.numeros || [])[0] || {};
  var bien = !!(num.voiceUrl && num.voiceUrl.indexOf('/telefono/entrante') >= 0);
  var dentro = '<div class="cifras">' +
    cifra(dg.desde || '—', 'número', 'bien') +
    cifra(dg.cuenta && dg.cuenta.tipo === 'Trial' ? 'prueba' : (dg.cuenta && dg.cuenta.tipo) || '?', 'cuenta', dg.cuenta && dg.cuenta.tipo === 'Trial' ? '' : 'bien') +
    cifra(bien ? 'sí' : 'NO', 'webhook apuntando al worker', bien ? 'bien' : 'mal') +
    cifra(dg.voz ? dg.voz.motor : '?', 'voz' + (dg.voz && dg.voz.voz ? ' · ' + dg.voz.voz : ''), dg.voz && dg.voz.motor === 'Fish Audio' ? 'bien' : '') +
    '</div>';
  if (!bien) dentro += '<p class="nada">El número no apunta a /telefono/entrante. Voice URL actual: ' + esc(num.voiceUrl || '(vacío)') + '</p>';
  dentro += '<p class="d">Números verificados en Twilio (a los que la cuenta de prueba puede llamar): ' +
    esc((dg.verificados || []).join(', ') || 'ninguno') + '</p>';
  dentro += '<p><input id="telA" placeholder="+52..." value="' + esc((dg.verificados || [])[0] || '') + '" style="width:14em"> ' +
    '<button id="telLlamar">Que Twilio me llame</button> <span id="telAviso" class="d"></span></p>';
  var tw = dg.llamadas || [];
  dentro += '<h3>Lo que Twilio registró</h3>' + (tw.length ? '<table>' + tw.map(function (c) {
    return '<tr><td>' + esc(haceCuanto(c.inicio)) + '</td><td>' + esc(c.direccion) + '</td><td>' + esc(c.de) + ' → ' + esc(c.a) +
      '</td><td>' + esc(c.estado) + '</td><td>' + esc(c.duracion || 0) + ' s</td></tr>' +
      (c.alertas || []).map(function (a) { return '<tr><td></td><td colspan="4" class="grave">error ' + esc(a.codigo) + ': ' + esc(a.texto) + '</td></tr>'; }).join('');
  }).join('') + '</table>' : '<p class="nada">Twilio no tiene ninguna llamada: lo que marcaste nunca llegó a Twilio (operadora, prefijo, o número).</p>');
  var nu = (ll && ll.llamadas) || [];
  dentro += '<h3>Lo que habló Kiyo</h3>' + (nu.length ? nu.slice(0, 5).map(function (c) {
    return '<p class="d">' + esc(haceCuanto(c.inicio)) + ' · ' + esc(c.direccion) + ' · ' + esc(c.a || c.de) +
      (c.resultado ? ' · <b>' + esc(c.resultado) + '</b>' : '') + '</p><ul>' +
      (c.turnos || []).slice(-8).map(function (t) { return '<li>' + esc(t.rol === 'vale' ? 'Kiyo: ' : 'Persona: ') + esc(t.texto) + '</li>'; }).join('') + '</ul>';
  }).join('') : '<p class="nada">Ninguna llamada ha llegado al worker todavía.</p>');
  return seccion('Teléfono', dentro);
}

function cargarTelefono() {
  var caja = document.getElementById('telefono');
  if (!caja) return;
  Promise.all([api('/telefono/diagnostico').then(function (r) { return r.json(); }), api('/telefono/llamadas').then(function (r) { return r.json(); })])
    .then(function (rs) {
      caja.outerHTML = pintarTelefono(rs[0], rs[1]);
      var b = document.getElementById('telLlamar');
      if (!b) return;
      b.onclick = function () {
        var a = document.getElementById('telA').value.trim(), av = document.getElementById('telAviso');
        b.disabled = true; av.textContent = 'Marcando…';
        api('/telefono/llamar', { method: 'POST', body: JSON.stringify({ a: a, nombre: 'Daniel', segundos: 240 }) })
          .then(function (r) { return r.json().then(function (j) { av.textContent = r.ok ? ('Twilio está llamando (' + (j.estado || j.sid) + '). Contesta y habla con Vale.') : ('No se pudo: ' + (j.error || r.status)); }); })
          .catch(function (e) { av.textContent = 'Error: ' + e; })
          .then(function () { b.disabled = false; setTimeout(cargarTelefono, 25000); });
      };
    })
    .catch(function (e) { caja.innerHTML = '<div><p class="nada">Teléfono: ' + esc(e) + '</p></div>'; });
}

function pintar(d) {
  document.getElementById('sello').textContent = 'leído ' + haceCuanto(d.cuando);
  var html = pintarVigilancia(d.vigilancia);
  (d.clientes || []).forEach(function (c) { html += pintarCliente(c); });
  html += pintarPropuestas(d.propuestas);
  html += pintarCorreo(d.correo);
  html += '<section id="telefono"><h2>Teléfono</h2><div><p class="d">Preguntándole a Twilio…</p></div></section>';
  document.getElementById('cuerpo').innerHTML = html;
  cargarTelefono();
}

function cargar() {
  return api('/tablero/datos').then(function (r) {
    if (r.status === 401) { pedirToken(); return; }
    return r.json().then(pintar);
  }).catch(function (e) {
    document.getElementById('cuerpo').innerHTML =
      '<section><h2>Error</h2><div><p class="nada">' + esc(e) + '</p></div></section>';
  });
}

function pedirToken() {
  localStorage.removeItem('bandeja');
  token = '';
  document.getElementById('puerta').hidden = false;
  document.getElementById('clave').focus();
}

document.getElementById('entrar').onclick = function () {
  var v = document.getElementById('clave').value.trim();
  if (!v) return;
  token = v;
  api('/tablero/datos').then(function (r) {
    if (!r.ok) { document.getElementById('mal').hidden = false; token = ''; return; }
    localStorage.setItem('bandeja', v);
    document.getElementById('puerta').hidden = true;
    return r.json().then(pintar);
  });
};
document.getElementById('clave').onkeydown = function (e) {
  if (e.key === 'Enter') document.getElementById('entrar').click();
};

document.getElementById('recargar').onclick = cargar;

document.getElementById('revisar').onclick = function () {
  var b = this;
  b.disabled = true;
  b.textContent = 'Revisando...';
  api('/bandeja/vigilancia', { method: 'POST' })
    .then(function () { return cargar(); })
    .catch(function () {})
    .then(function () { b.disabled = false; b.textContent = 'Revisar ahora'; });
};

if (!token) pedirToken(); else cargar();
</script>
</body></html>`;

/* Devuelve una Response si la petición era para el tablero, o null si no.
   Igual que la bandeja: va ANTES del control de origen, porque no es un
   cliente — eres tú. */
export async function atender(peticion, env, ruta, autorizado, json) {
  if (!ruta.startsWith('/tablero')) return null;

  if (ruta === '/tablero' && peticion.method === 'GET') {
    return new Response(PAGINA, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (!autorizado(peticion, env)) return json({ error: 'no autorizado' }, 401);
  if (!env.DB) return json({ error: 'no hay base configurada' }, 503);

  if (ruta === '/tablero/datos' && peticion.method === 'GET') {
    return json(await datos(env));
  }

  return json({ error: 'no existe' }, 404);
}
