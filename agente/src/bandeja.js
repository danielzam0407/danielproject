/* La bandeja: donde tú lees lo que el agente dijo.

   Es la fuga número uno del catálogo — un agente cuyas conversaciones nadie ve
   no tiene supervisión, no deja rastro si un cliente reclama, y nadie se entera
   cuando alguien pidió ayuda y no se la dieron.

   Va montada en el propio worker a propósito: así la página y los datos son del
   mismo origen y no hace falta abrirle CORS a nada. El token nunca viaja en la
   URL —ni en un query string— porque las URLs quedan en historiales y en logs.
   Viaja en la cabecera Authorization y se guarda en el navegador. */

import * as almacen from './almacen.js';
import { todas } from './clientes/index.js';
import { vigilar } from './vigilante.js';

/* Comparación sin salida temprana: un `===` normal devuelve antes en cuanto
   dos caracteres difieren, y eso filtra por tiempo cuánto acertaste. */
function igual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function autorizado(peticion, env) {
  if (!env.BANDEJA_TOKEN) return false;
  const cabecera = peticion.headers.get('authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';
  return igual(token, env.BANDEJA_TOKEN);
}

function json(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Esta respuesta trae conversaciones de gente real. Que no quede en
      // ninguna caché intermedia.
      'cache-control': 'no-store',
    },
  });
}

/* Devuelve una Response si la petición era para la bandeja, o null si no.
   Se llama ANTES del control de origen: la bandeja no es un cliente. */
export async function atender(peticion, env, ruta) {
  if (!ruta.startsWith('/bandeja')) return null;

  if (ruta === '/bandeja' && peticion.method === 'GET') {
    return new Response(PAGINA, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (!autorizado(peticion, env)) {
    return json({ error: 'no autorizado' }, 401);
  }
  if (!env.DB) return json({ error: 'no hay base configurada' }, 503);

  // La lista de clientes es lo primero que pide la página, y todavía no sabe
  // de cuál preguntar. Por eso se atiende antes de exigir el parámetro.
  if (ruta === '/bandeja/clientes') {
    return json({ clientes: todas().map((f) => ({ id: f.id, nombre: f.nombre })) });
  }

  /* La vigilancia. Va montada aquí y no en una ruta propia por una razón de
     seguridad, no de comodidad: el token de la bandeja ya existe y ya está
     probado. Una puerta nueva en un endpoint público es superficie nueva de
     autenticación, y ésas se abren una vez y se quedan abiertas.

     No lleva `cliente`: el vigilante mira los sitios y el worker, que son de
     la casa, no de una empresa. Por eso se atiende antes de exigirlo. */
  if (ruta === '/bandeja/vigilancia') {
    if (peticion.method === 'POST') {
      // A demanda. El cron corre a las 9:00 UTC; esto es para no esperar un
      // día entero cuando acabas de cambiar algo y quieres saber si aguantó.
      const hallazgos = await vigilar(env);
      return json({ cuando: new Date().toISOString(), hallazgos });
    }
    const filas = await env.DB
      .prepare('SELECT cuando, hallazgos FROM vigilancia ORDER BY id DESC LIMIT 20')
      .all();
    return json({
      corridas: (filas.results || []).map((f) => ({
        cuando: f.cuando,
        hallazgos: JSON.parse(f.hallazgos || '[]'),
      })),
    });
  }

  const url = new URL(peticion.url);
  const cliente = url.searchParams.get('cliente') || '';
  if (!todas().some((f) => f.id === cliente)) {
    return json({ error: 'cliente desconocido' }, 400);
  }

  if (ruta === '/bandeja/sesiones' && peticion.method === 'GET') {
    return json({ sesiones: await almacen.listarSesiones(env.DB, cliente) });
  }

  if (ruta === '/bandeja/sesion' && peticion.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const hilo = await almacen.leerSesion(env.DB, cliente, id);
    return hilo ? json(hilo) : json({ error: 'no existe' }, 404);
  }

  if (ruta === '/bandeja/atendida' && peticion.method === 'POST') {
    const cuerpo = await peticion.json().catch(() => ({}));
    const ok = await almacen.marcarAtendida(env.DB, cliente, String(cuerpo.id || ''));
    return ok ? json({ ok: true }) : json({ error: 'no existe' }, 404);
  }

  return json({ error: 'ruta desconocida' }, 404);
}

/* La página. Va aquí dentro y no en un archivo aparte porque un Worker no
   sirve archivos estáticos: lo que no está en el bundle no existe. */
const PAGINA = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Bandeja</title>
<style>
:root{--g:#0d1215;--p:#141b1f;--l:#2a363b;--t:#dfe5e7;--d:#9ba8ad;--a:#5fb6ce;--w:#d2a93f}
*{box-sizing:border-box}
body{margin:0;background:var(--g);color:var(--t);font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
header{border-bottom:2px solid var(--l);padding:14px 18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:13px;letter-spacing:.18em;text-transform:uppercase;margin:0;color:var(--a)}
select,button{background:var(--p);color:var(--t);border:1px solid var(--l);padding:6px 9px;font:inherit;border-radius:0}
button{cursor:pointer}
button:hover,select:hover{border-color:var(--a)}
button:focus-visible,select:focus-visible{outline:2px solid var(--a);outline-offset:2px}
main{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);min-height:calc(100vh - 53px)}
@media(max-width:760px){main{grid-template-columns:minmax(0,1fr)}}
#lista{border-right:1px solid var(--l);overflow-y:auto;max-height:calc(100vh - 53px)}
.s{padding:11px 14px;border-bottom:1px solid var(--l);cursor:pointer}
.s:hover{background:var(--p)}
.s.on{background:var(--p);border-left:3px solid var(--a);padding-left:11px}
.s b{display:block;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s span{color:var(--d);font-size:12px}
.tag{display:inline-block;border:1px solid currentColor;padding:0 5px;margin-left:6px;font-size:11px;font-style:normal}
.lead{color:var(--w)}
.nueva{color:var(--a)}
#hilo{padding:18px;overflow-y:auto;max-height:calc(100vh - 53px)}
.m{margin:0 0 14px;max-width:70ch}
.m .q{color:var(--d);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
.m.visitante .q{color:var(--a)}
.m p{margin:2px 0 0;white-space:pre-wrap}
.av{border:1px solid var(--w);color:var(--w);padding:9px 12px;margin:0 0 14px;white-space:pre-wrap}
.vacio{color:var(--d);padding:18px}
#puerta{position:fixed;inset:0;background:var(--g);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;padding:24px}
#puerta[hidden]{display:none}
#puerta label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--a)}
#puerta input{background:var(--p);color:var(--t);border:1px solid var(--l);padding:9px 11px;
  font:inherit;border-radius:0;width:min(340px,90vw)}
#puerta input:focus-visible{outline:2px solid var(--a);outline-offset:2px}
#puerta button{width:min(340px,90vw)}
#mal{color:var(--w);margin:0;font-size:12px}
#mal[hidden]{display:none}
</style></head><body>
<header>
  <h1>Bandeja</h1>
  <select id="cliente" aria-label="Cliente"></select>
  <button id="recargar">Recargar</button>
  <button id="salir">Olvidar token</button>
</header>
<main>
  <div id="lista"></div>
  <div id="hilo"><p class="vacio">Elige una conversación.</p></div>
</main>
<form id="puerta" hidden>
  <label for="clave">Token de la bandeja</label>
  <input id="clave" type="password" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
  <p id="mal" hidden>Ese token no es.</p>
</form>
<script>
var $ = function (s) { return document.querySelector(s); };
var token = localStorage.getItem('bandeja') || '';
var cliente = '';
var actual = '';

function api(ruta, opciones) {
  opciones = opciones || {};
  var cabeceras = opciones.headers || {};
  cabeceras.authorization = 'Bearer ' + token;
  opciones.headers = cabeceras;
  return fetch(ruta, opciones);
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[<&]/g, function (c) {
    return c === '<' ? '&lt;' : '&amp;';
  });
}

function corta(t, n) {
  t = t || '(sin mensaje)';
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* La puerta. Un formulario y no un prompt(): el diálogo del navegador bloquea
   la página entera, no se puede estilar, y algunos navegadores lo suprimen sin
   avisar — con lo que la bandeja se queda en blanco y parece rota. */
function pedirToken(fallo) {
  token = '';
  localStorage.removeItem('bandeja');
  $('#puerta').hidden = false;
  $('#mal').hidden = !fallo;
  $('#clave').value = '';
  $('#clave').focus();
}

$('#puerta').addEventListener('submit', function (e) {
  e.preventDefault();
  token = $('#clave').value.trim();
  if (!token) return;
  localStorage.setItem('bandeja', token);
  $('#puerta').hidden = true;
  clientes();
});

function clientes() {
  api('/bandeja/clientes').then(function (r) {
    if (r.status === 401) { pedirToken(true); return null; }
    return r.json();
  }).then(function (d) {
    if (!d) return;
    var lista = d.clientes || [];
    $('#cliente').innerHTML = lista.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.nombre) + '</option>';
    }).join('');
    cliente = lista.length ? lista[0].id : '';
    if (cliente) sesiones();
  });
}

function sesiones() {
  api('/bandeja/sesiones?cliente=' + encodeURIComponent(cliente))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var ss = (d && d.sesiones) || [];
      if (!ss.length) {
        $('#lista').innerHTML = '<p class="vacio">Sin conversaciones todavía.</p>';
        return;
      }
      $('#lista').innerHTML = ss.map(function (s) {
        var marcas = '';
        if (s.avisos) marcas += '<em class="tag lead">' + s.avisos + ' lead</em>';
        if (!s.atendida) marcas += '<em class="tag nueva">nueva</em>';
        return '<div class="s' + (s.id === actual ? ' on' : '') + '" data-id="' + esc(s.id) + '">' +
          '<b>' + esc(corta(s.primera, 64)) + '</b>' +
          '<span>' + esc(s.vista.slice(0, 16).replace('T', ' ')) +
          ' · ' + s.turnos + ' turnos' + marcas + '</span></div>';
      }).join('');
      Array.prototype.forEach.call($('#lista').querySelectorAll('.s'), function (e) {
        e.onclick = function () { abrir(e.getAttribute('data-id')); };
      });
    });
}

function abrir(id) {
  actual = id;
  api('/bandeja/sesion?cliente=' + encodeURIComponent(cliente) + '&id=' + encodeURIComponent(id))
    .then(function (r) {
      if (!r.ok) return null;
      return r.json();
    })
    .then(function (h) {
      if (!h) { $('#hilo').innerHTML = '<p class="vacio">No se pudo leer.</p>'; return; }
      var avisos = (h.avisos || []).map(function (a) {
        return '<div class="av">' + esc(a.titulo) +
          (a.entregado ? '' : ' — NO ENTREGADO') + '\\n\\n' + esc(a.cuerpo) + '</div>';
      }).join('');
      var turnos = (h.mensajes || []).map(function (m) {
        return '<div class="m ' + esc(m.rol) + '"><span class="q">' + esc(m.rol) +
          '</span><p>' + esc(m.texto) + '</p></div>';
      }).join('');
      $('#hilo').innerHTML = avisos + turnos;
      return api('/bandeja/atendida?cliente=' + encodeURIComponent(cliente), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
    })
    .then(function () { sesiones(); });
}

$('#cliente').onchange = function (e) { cliente = e.target.value; actual = ''; sesiones(); };
$('#recargar').onclick = function () { sesiones(); };
$('#salir').onclick = function () { pedirToken(false); };

if (token) clientes(); else pedirToken(false);
</script></body></html>`;
