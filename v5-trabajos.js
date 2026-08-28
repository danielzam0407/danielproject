/* Las piezas vivas de la seccion de trabajo.

   Dos animaciones hechas en Claude Design —Ferropalacios y el inventario de
   Novatek— montadas en `#trabajo` de la cara v5.

   ── Por que esto vive AQUI y no dentro del HTML ────────────────────────────

   v5.html es una pagina de Claude Design: el bloque <x-dc> va de la linea 18 a
   la 434, y `#trabajo` esta adentro. Una sincronizacion desde Design regenera
   ese bloque entero y se lleva lo que este dentro. Asi que las tarjetas se
   inyectan desde fuera, se re-aplican con un MutationObserver colgado del
   <body> (nunca de una seccion: muere con ella), y son idempotentes.

   ── La animacion, y por que NO se re-monta el iframe ───────────────────────

   Al abrir una pieza, el marco pasa a `position:fixed` con la geometria FINAL
   —la pantalla completa— y se le aplica de inmediato la transformacion inversa
   que lo devuelve visualmente al hueco de la tarjeta. Luego se anima esa
   transformacion hasta la identidad. Es un FLIP.

   Se hace asi por una razon dura: mover un <iframe> en el arbol del DOM lo
   RECARGA. Cualquier version que reparente el nodo reinicia la animacion justo
   cuando el visitante la abre — que es el unico momento en que la esta viendo.
   Aqui el iframe no cambia de padre nunca; lo unico que se mueve es su marco.

   ── Nada invisible esperando animacion (regla 3) ───────────────────────────

   El estado FINAL de la tarjeta es el estado por omision en el CSS. La entrada
   solo QUITA una clase; si no hay IntersectionObserver, si el frame loop no
   corre, o si el visitante pidio menos movimiento, las tarjetas ya estan
   visibles y completas. */
(function () {
  'use strict';

  var PIEZAS = [
    {
      id: 'ferropalacios',
      src: 'piezas/ferropalacios.html',
      titulo: 'Una ferreteria que vende de noche',
      tituloEn: 'A hardware store that sells at night',
      meta: 'ferropalacios · catalogo y carrito',
      metaEn: 'ferropalacios · catalog and cart',
      // El acento de la propia pieza: la tarjeta lo toma prestado para el
      // filo y el punto, y asi cada trabajo se anuncia con su propio color.
      tinte: '#e08544',
      fondo: '#0e1013'
    },
    {
      id: 'novatek',
      src: 'piezas/novatek.html',
      titulo: 'Un inventario que lo lleva un agente',
      tituloEn: 'An inventory an agent runs',
      meta: 'novatek · tablero y agente',
      metaEn: 'novatek · dashboard and agent',
      tinte: '#416180',
      fondo: '#f2f2f3'
    }
  ];

  var quieto = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── el estilo, una sola vez ─────────────────────────────────────────── */
  function estilo() {
    if (document.getElementById('pz-estilo')) return;
    var s = document.createElement('style');
    s.id = 'pz-estilo';
    s.textContent = [
      '.pz{display:block;position:relative;text-decoration:none;color:inherit;grid-column:span 1}',
      '@media(min-width:900px){.pz{grid-column:span 3}}',

      /* El marco. `contain` lo saca del calculo de layout del resto: sin eso,
         un iframe de 1920x1080 escalado obliga a recalcular la pagina entera
         en cada cuadro de la animacion de dentro. */
      '.pz-marco{position:relative;aspect-ratio:16/10;overflow:hidden;',
      '  border:1px solid var(--hair);background:var(--panel);contain:paint;',
      '  transition:border-color .35s cubic-bezier(.16,1,.3,1)}',
      '.pz:hover .pz-marco{border-color:var(--pz-tinte,var(--accent))}',

      /* El iframe corre a 1280x800 y se escala: si se le da el tamano de la
         tarjeta, la pieza —que esta compuesta para 1920x1080— sale con la
         tipografia diminuta. Escalar conserva la composicion. */
      '.pz-lienzo{position:absolute;left:0;top:0;width:1280px;height:800px;',
      '  transform-origin:0 0;border:0;opacity:0;',
      '  transition:opacity .6s cubic-bezier(.16,1,.3,1)}',
      '.pz-marco.lista .pz-lienzo{opacity:1}',

      /* El velo: lo que se ve mientras la pieza carga. No es un spinner —
         es la tarjeta terminada, y la pieza aparece encima cuando esta. */
      '.pz-velo{position:absolute;inset:0;display:flex;align-items:flex-end;',
      '  padding:16px;background:var(--pz-fondo,var(--panel));',
      '  transition:opacity .6s cubic-bezier(.16,1,.3,1)}',
      '.pz-marco.lista .pz-velo{opacity:0;pointer-events:none}',
      '.pz-velo span{font-family:"JetBrains Mono",monospace;font-size:9px;',
      '  letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}',

      /* La chapa de "abrir": aparece al pasar, como en las piezas mismas. */
      '.pz-abrir{position:absolute;right:14px;bottom:14px;display:flex;',
      '  align-items:center;gap:8px;padding:9px 14px;',
      '  background:var(--pz-tinte,var(--accent));color:#fff;',
      '  font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.2em;',
      '  text-transform:uppercase;opacity:0;transform:translateY(6px);',
      '  transition:opacity .3s,transform .3s cubic-bezier(.16,1,.3,1);z-index:3}',
      '.pz:hover .pz-abrir,.pz:focus-visible .pz-abrir{opacity:1;transform:none}',

      '.pz-pie{display:flex;justify-content:space-between;align-items:baseline;',
      '  margin-top:11px;gap:12px}',
      '.pz-pie b{font-size:16px;font-weight:700;letter-spacing:-.02em}',
      '.pz-pie i{font-style:normal;font-family:"JetBrains Mono",monospace;',
      '  font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}',

      /* Entrada. El estado FINAL es el de arriba; esto solo describe de donde
         viene, y se quita en cuanto entra a cuadro. */
      '.pz.entra{opacity:0;transform:translateY(18px)}',
      '.pz{opacity:1;transform:none;',
      '  transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}',

      /* Abierta a pantalla completa. */
      '.pz-marco.abierta{position:fixed;z-index:200;border-color:transparent;',
      '  will-change:transform}',
      '.pz-telon{position:fixed;inset:0;z-index:199;background:#05060a;',
      '  opacity:0;transition:opacity .5s cubic-bezier(.16,1,.3,1)}',
      '.pz-telon.on{opacity:.94}',
      '.pz-cerrar{position:fixed;top:18px;right:20px;z-index:201;',
      '  border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;',
      '  font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.24em;',
      '  text-transform:uppercase;padding:11px 16px;cursor:pointer;opacity:0;',
      '  transition:opacity .4s,background-color .25s}',
      '.pz-cerrar.on{opacity:1}',
      '.pz-cerrar:hover{background:rgba(255,255,255,.14)}',
      '@media(prefers-reduced-motion:reduce){',
      '  .pz,.pz-marco,.pz-lienzo,.pz-velo,.pz-telon,.pz-cerrar{transition:none!important}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── el iframe se escala para llenar su marco ────────────────────────── */
  function encuadrar(marco) {
    var lienzo = marco.querySelector('.pz-lienzo');
    if (!lienzo) return;
    var r = marco.getBoundingClientRect();
    if (!r.width) return;
    var k = Math.max(r.width / 1280, r.height / 800);
    lienzo.style.transform =
      'translate(' + ((r.width - 1280 * k) / 2) + 'px,' +
      ((r.height - 800 * k) / 2) + 'px) scale(' + k + ')';
  }

  /* ── abrir / cerrar, con FLIP ────────────────────────────────────────── */
  var abierta = null;

  function cerrar() {
    if (!abierta) return;
    var marco = abierta.marco, hueco = abierta.hueco;
    var destino = hueco.getBoundingClientRect();
    var r = marco.getBoundingClientRect();

    marco.style.transition = quieto ? 'none' :
      'transform .55s cubic-bezier(.16,1,.3,1)';
    marco.style.transform =
      'translate(' + (destino.left - r.left) + 'px,' + (destino.top - r.top) +
      'px) scale(' + (destino.width / r.width) + ')';

    abierta.telon.classList.remove('on');
    abierta.boton.classList.remove('on');
    document.documentElement.style.overflow = '';

    var fin = function () {
      marco.classList.remove('abierta');
      marco.removeAttribute('style');
      hueco.style.display = 'none';
      encuadrar(marco);
      if (abierta) {
        abierta.telon.remove();
        abierta.boton.remove();
        if (abierta.foco && abierta.foco.focus) abierta.foco.focus();
      }
      abierta = null;
      window.removeEventListener('keydown', alaTecla);
    };
    // Salida garantizada: si la transicion no corre —pane sin composicion,
    // pestana en segundo plano, menos movimiento— el temporizador cierra igual.
    if (quieto) fin();
    else setTimeout(fin, 570);
  }

  function alaTecla(e) {
    if (e.key === 'Escape') cerrar();
  }

  function abrir(art) {
    if (abierta) return;
    var marco = art.querySelector('.pz-marco');
    if (!marco) return;
    cargar(marco);

    var r = marco.getBoundingClientRect();

    // El hueco sostiene el espacio de la tarjeta mientras el marco se va a
    // fixed. Sin el, la rejilla colapsa y la pagina da un brinco.
    var hueco = art.querySelector('.pz-hueco');
    hueco.style.display = 'block';
    hueco.style.height = r.height + 'px';

    var telon = document.createElement('div');
    telon.className = 'pz-telon';
    document.body.appendChild(telon);

    var boton = document.createElement('button');
    boton.className = 'pz-cerrar';
    boton.type = 'button';
    boton.textContent = 'cerrar ✕';
    boton.addEventListener('click', cerrar);
    document.body.appendChild(boton);

    // Geometria FINAL primero, transformacion inversa despues: el iframe se
    // dibuja una sola vez al tamano grande y solo se escala.
    var m = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.045);
    var fw = window.innerWidth - m * 2, fh = window.innerHeight - m * 2;
    marco.classList.add('abierta');
    marco.style.left = m + 'px';
    marco.style.top = m + 'px';
    marco.style.width = fw + 'px';
    marco.style.height = fh + 'px';
    marco.style.transformOrigin = '0 0';
    marco.style.transition = 'none';
    marco.style.transform =
      'translate(' + (r.left - m) + 'px,' + (r.top - m) + 'px) scale(' +
      (r.width / fw) + ')';
    encuadrar(marco);

    abierta = { marco: marco, hueco: hueco, telon: telon, boton: boton, foco: art };
    window.addEventListener('keydown', alaTecla);
    document.documentElement.style.overflow = 'hidden';

    // Dos cuadros: uno para que el navegador acepte la geometria inicial, y
    // hasta el siguiente se enciende la transicion. Con uno solo, Chrome
    // colapsa las dos escrituras y la tarjeta aparece grande de golpe.
    var soltar = function () {
      if (!abierta || abierta.marco !== marco || marco.style.transform === 'none') return;
      marco.style.transition = quieto ? 'none' :
        'transform .6s cubic-bezier(.16,1,.3,1)';
      marco.style.transform = 'none';
      telon.classList.add('on');
      boton.classList.add('on');
    };
    requestAnimationFrame(function () { requestAnimationFrame(soltar); });
    /* Salida garantizada (regla 3 de la casa): si rAF no corre —pestana en
       segundo plano al momento del clic, o un contexto que no compone— los dos
       cuadros de arriba nunca llegan y la pieza se queda ENCOGIDA en la esquina,
       con el telon apagado. Medido en el Browser pane, que es justo asi.
       El temporizador no depende del frame loop y deja el estado final igual. */
    setTimeout(soltar, 120);
  }

  /* ── carga diferida ──────────────────────────────────────────────────── */
  function cargar(marco) {
    if (marco.dataset.cargado === '1') return;
    marco.dataset.cargado = '1';
    var lienzo = marco.querySelector('.pz-lienzo');
    if (!lienzo) return;
    lienzo.addEventListener('load', function () {
      marco.classList.add('lista');
      encuadrar(marco);
    });
    lienzo.src = lienzo.dataset.src;
    // Respaldo: si el `load` no llega —bloqueado, sin red— el velo se queda
    // puesto y la tarjeta sigue siendo una tarjeta, no un hueco negro.
    setTimeout(function () {
      if (lienzo.contentWindow) { marco.classList.add('lista'); encuadrar(marco); }
    }, 6000);
  }

  /* ── montaje ─────────────────────────────────────────────────────────── */
  function tarjeta(p, i) {
    var art = document.createElement('article');
    art.className = 'pz entra';
    art.setAttribute('data-pz', p.id);
    art.setAttribute('data-cursor', 'ver pieza');
    art.setAttribute('tabindex', '0');
    art.setAttribute('role', 'button');
    art.setAttribute('aria-label', p.titulo);
    art.style.setProperty('--pz-tinte', p.tinte);
    art.style.setProperty('--pz-fondo', p.fondo);
    art.style.transitionDelay = (i * 0.09) + 's';

    art.innerHTML =
      '<div class="pz-hueco" style="display:none"></div>' +
      '<div class="pz-marco">' +
        '<iframe class="pz-lienzo" title="' + p.titulo + '" loading="lazy" ' +
          'tabindex="-1" aria-hidden="true" scrolling="no" ' +
          'sandbox="allow-scripts allow-same-origin" data-src="' + p.src + '"></iframe>' +
        '<div class="pz-velo"><span>' + p.meta + '</span></div>' +
        '<span class="pz-abrir">abrir ↗</span>' +
      '</div>' +
      '<div class="pz-pie"><b data-en="' + p.tituloEn + '">' + p.titulo + '</b>' +
      '<i data-en="' + p.metaEn + '">' + p.meta + '</i></div>';

    art.addEventListener('click', function () { abrir(art); });
    art.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(art); }
    });
    return art;
  }

  function montar() {
    var seccion = document.getElementById('trabajo');
    if (!seccion) return;
    var rejilla = seccion.querySelector('div[style*="grid-template-columns"]');
    if (!rejilla) return;
    // Idempotente: el componente se repinta solo, y esto corre en cada pasada
    // del observador.
    if (rejilla.querySelector('.pz')) return;

    estilo();

    // La rejilla del componente es `auto-fit minmax(300px,1fr)`. Se fija a 6
    // columnas para que una pieza pueda ocupar media fila y las tarjetas de
    // relleno una tercera parte: las piezas de verdad van primero y mandan.
    rejilla.style.gridTemplateColumns = 'repeat(6,minmax(0,1fr))';
    Array.prototype.forEach.call(rejilla.children, function (n) {
      if (!n.classList.contains('pz')) n.style.gridColumn = 'span 2';
    });

    var arts = PIEZAS.map(tarjeta);
    arts.reverse().forEach(function (a) { rejilla.insertBefore(a, rejilla.firstChild); });
    arts = Array.prototype.slice.call(rejilla.querySelectorAll('.pz'));

    /* Entrada y carga. El observador SOLO quita `entra` y dispara la carga;
       si no existe, el bucle de abajo lo hace de inmediato y la seccion queda
       en su estado final igual. */
    if ('IntersectionObserver' in window && !quieto) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.remove('entra');
          cargar(e.target.querySelector('.pz-marco'));
          io.unobserve(e.target);
        });
      }, { rootMargin: '160px' });
      arts.forEach(function (a) { io.observe(a); });
      // Red de seguridad: si en 2.5 s alguna sigue invisible —observador que
      // no dispara, pestana en segundo plano— se revela a mano.
      setTimeout(function () {
        arts.forEach(function (a) { a.classList.remove('entra'); });
      }, 2500);
    } else {
      arts.forEach(function (a) {
        a.classList.remove('entra');
        cargar(a.querySelector('.pz-marco'));
      });
    }

    if (!montar.ligado) {
      montar.ligado = true;
      window.addEventListener('resize', function () {
        document.querySelectorAll('.pz-marco').forEach(encuadrar);
        if (abierta) cerrar();
      });
    }
  }

  /* El componente se repinta solo: el observador va colgado del <body> y no
     de una seccion, que muere con ella. */
  function arrancar() {
    montar();
    new MutationObserver(function () { montar(); })
      .observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
