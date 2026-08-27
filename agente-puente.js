/* El puente entre la cara nueva y el agente de verdad.

   Vive FUERA del bloque <x-dc> a proposito (regla 1 de la casa): una
   sincronizacion desde Claude Design regenera el componente y borra lo que
   este adentro. Esto es lo caro de rehacer; el componente no.

   El prototipo del handoff llamaba a `window.claude.complete` y esperaba de
   vuelta un JSON con {reply, action, accent, scrollTo}. Esa funcion solo
   existe dentro de Claude Design. El worker desplegado hace mas: transmite
   por SSE y trae herramientas de verdad —cambiar_piel, mostrar_trabajo,
   dejar_recado—, y ya paso por el auditor. Asi que la cara nueva se cuelga de
   ESE agente en vez de estrenar uno: cambiarle el prompt o las herramientas
   seria un cambio de seguridad (regla 7), y aqui no hace falta ninguno. */
(function () {
  'use strict';

  var ENDPOINT = 'https://daniel-agente.daniii.workers.dev';

  /* La misma llave que usa la portada: es el mismo visitante hablando con el
     mismo agente, y si abre las dos paginas no debe empezar de cero. */
  var CLAVE = 'ag-sesion';

  var sesion = '';
  try { sesion = sessionStorage.getItem(CLAVE) || ''; } catch (e) {}

  /* Un bloque SSE: lineas 'event:' y 'data:', separadas por linea en blanco. */
  function leerBloque(bloque) {
    var evento = 'message', datos = '';
    var lineas = bloque.split('\n');
    for (var i = 0; i < lineas.length; i++) {
      var l = lineas[i];
      if (l.indexOf('event:') === 0) evento = l.slice(6).trim();
      else if (l.indexOf('data:') === 0) datos += l.slice(5).trim();
    }
    if (!datos) return null;
    try { return { evento: evento, datos: JSON.parse(datos) }; }
    catch (e) { return null; }
  }

  /* Pregunta al agente. `cb` recibe:
       onTexto(t)    cada trozo de la respuesta, en orden
       onAccion(a)   una accion de herramienta ya validada por el worker
       onError(msg)  el agente contesto pero con error (cuota, origen, caida)
     Devuelve true si llego a escribir aunque sea una letra. Si devuelve false,
     quien llama decide si usa su respaldo local: el sitio nunca se queda mudo. */
  async function preguntar(texto, cb) {
    cb = cb || {};
    var hubo = false;

    var r;
    try {
      r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto,
          sesion: sesion,
          contexto: contexto()
        })
      });
    } catch (e) {
      return false;                       // sin red: que conteste el respaldo
    }

    if (!r.ok || !r.body) {
      var fallo = await r.json().catch(function () { return {}; });
      /* 429 y 403 son respuestas de verdad, no una caida: el respaldo local
         diria una mentira alegre en vez del motivo. Eso se muestra tal cual. */
      if ((r.status === 429 || r.status === 403) && fallo.error) {
        if (cb.onError) cb.onError(fallo.error);
        return true;
      }
      return false;
    }

    var lector = r.body.getReader();
    var dec = new TextDecoder();
    var resto = '';

    while (true) {
      var trozo = await lector.read();
      if (trozo.done) break;
      resto += dec.decode(trozo.value, { stream: true });
      var corte;
      while ((corte = resto.indexOf('\n\n')) >= 0) {
        var leido = leerBloque(resto.slice(0, corte));
        resto = resto.slice(corte + 2);
        if (!leido) continue;
        if (leido.evento === 'sesion') {
          sesion = leido.datos.id;
          try { sessionStorage.setItem(CLAVE, sesion); } catch (e) {}
        } else if (leido.evento === 'texto') {
          hubo = true;
          if (cb.onTexto) cb.onTexto(leido.datos.t);
        } else if (leido.evento === 'accion') {
          if (cb.onAccion) cb.onAccion(leido.datos);
        } else if (leido.evento === 'error') {
          hubo = true;
          if (cb.onError) cb.onError(leido.datos.mensaje);
        }
      }
    }
    return hubo;
  }

  /* Como se ve la pagina ahora mismo, para que el agente no trabaje a ciegas.
     La ficha del worker valida cada campo otra vez: esto viene del cliente
     igual que el mensaje. */
  function contexto() {
    var raiz = document.documentElement;
    var leer = function (v) {
      return getComputedStyle(raiz).getPropertyValue(v).trim();
    };
    var acento = leer('--accent').toLowerCase();
    return {
      piel: {
        color: /^#[0-9a-f]{6}$/.test(acento) ? acento : null,
        modo: raiz.getAttribute('data-tema') === 'oscuro' ? 'oscuro' : 'claro'
      },
      bloques: []
    };
  }

  /* El agente de verdad a veces devuelve un enlace —whatsapp, una llamada—.
     El prototipo nunca tuvo eso porque su agente era de mentiras, asi que el
     diseno no trae ranura para botones. En vez de inventar un lenguaje visual
     nuevo, el boton se arma con el mismo vocabulario que ya usan los chips del
     panel: pastilla, borde de pelo, mono de 9.5px.

     Se pinta desde aqui —y no desde el componente— para que una sincronizacion
     desde Claude Design no se lo lleve: alla adentro solo queda la llamada. */
  function burbuja() {
    var todas = document.querySelectorAll('[data-agente-respuesta]');
    for (var i = todas.length - 1; i >= 0; i--) {
      if (todas[i].offsetParent) return todas[i];   // la que esta a la vista
    }
    return null;
  }

  function limpiarAcciones() {
    var viejas = document.querySelectorAll('[data-agente-accion]');
    for (var i = 0; i < viejas.length; i++) viejas[i].remove();
  }

  function pintarAccion(accion) {
    var destino = burbuja();
    if (!destino || !accion || !accion.url) return;

    /* Solo http(s). Sin esto, una url de otro esquema —javascript:, data:—
       llegada desde el modelo se volveria un enlace ejecutable en la pagina. */
    var url;
    try { url = new URL(accion.url, location.href); } catch (e) { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

    var a = document.createElement('a');
    a.setAttribute('data-agente-accion', '');
    a.setAttribute('data-cursor', 'abrir');
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = (accion.etiqueta || 'abrir') + ' →';
    a.style.cssText =
      'display:inline-flex;align-items:center;margin-top:12px;' +
      'border:1px solid var(--accent);color:var(--accent);' +
      "font-family:'JetBrains Mono',monospace;font-size:9.5px;" +
      'letter-spacing:.2em;text-transform:uppercase;padding:9px 15px;' +
      'border-radius:999px;white-space:nowrap';
    destino.parentNode.insertBefore(a, destino.nextSibling);
  }

  /* El boton de WhatsApp del diseno llega apuntando a #inicio: el prototipo no
     tenia de donde sacar el numero. El worker si lo sirve en /contacto, y vive
     alla a proposito — asi el numero no queda escrito en un repo publico,
     donde lo raspa cualquier bot de spam, y hay un solo lugar donde cambiarlo.

     Se engancha por `data-cursor="whatsapp"`, que es un atributo del propio
     diseno: sobrevive a una sincronizacion desde Claude Design. Y se re-aplica
     con un MutationObserver colgado del <body> —nunca de una seccion, que
     muere con ella— porque el componente se repinta solo y se lleva el href. */
  var urlWhatsapp = null;
  var pendiente = false;

  function ponerWhatsapp() {
    pendiente = false;
    marcarPanel();
    if (!urlWhatsapp) return;
    var botones = document.querySelectorAll('[data-cursor="whatsapp"]');
    for (var i = 0; i < botones.length; i++) {
      if (botones[i].getAttribute('href') === urlWhatsapp) continue;  // idempotente
      botones[i].setAttribute('href', urlWhatsapp);
      botones[i].setAttribute('target', '_blank');
      botones[i].setAttribute('rel', 'noopener noreferrer');
    }
  }

  /* La mascota se recarga en el recuadro del agente al final de la pagina, y
     para eso necesita saber cual es. Se marca desde aqui —fuera del bloque
     <x-dc>— y se busca por estructura, no por una clase: se sube desde el
     campo de texto hasta el primer ancestro con sombra, que es el canto del
     recuadro. Asi aguanta que el diseno cambie de estilos. */
  function marcarPanel() {
    if (document.querySelector('[data-panel-agente]')) return;   // idempotente
    var campo = document.querySelector('#contacto input');
    if (!campo) return;
    var el = campo.parentElement;
    for (var i = 0; i < 6 && el; i++) {
      if (getComputedStyle(el).boxShadow !== 'none') {
        el.setAttribute('data-panel-agente', '');
        return;
      }
      el = el.parentElement;
    }
  }

  function agendarWhatsapp() {
    if (pendiente) return;
    pendiente = true;
    /* setTimeout y no requestAnimationFrame: esto no es una animacion, y un
       parche al DOM que depende del frame loop no se aplica donde el loop no
       corre (regla 3 de la casa, y el Browser pane es justo ese caso). */
    setTimeout(ponerWhatsapp, 0);
  }

  fetch(ENDPOINT + '/contacto')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.whatsapp) return;
      var u;
      try { u = new URL(d.whatsapp); } catch (e) { return; }
      if (u.protocol !== 'https:') return;
      urlWhatsapp = u.href;
      ponerWhatsapp();
    })
    .catch(function () {});   // sin numero, el boton se queda como estaba

  new MutationObserver(agendarWhatsapp).observe(document.body, {
    childList: true, subtree: true
  });

  // primera pasada: el componente puede montar sin disparar mutacion util
  setTimeout(ponerWhatsapp, 0);

  window.nervAgente = {
    preguntar: preguntar,
    pintarAccion: pintarAccion,
    limpiarAcciones: limpiarAcciones,
    endpoint: ENDPOINT,
    get sesion() { return sesion; }
  };
})();
