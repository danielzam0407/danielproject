/* Los carretes de la seccion de trabajo.

   Cinco trabajos, todos video: las dos piezas nuevas —Ferropalacios y el
   inventario de Novatek— y los tres carretes que ya vivian en la portada
   anterior.

   ── Por que esto vive AQUI y no dentro del HTML ────────────────────────────

   v5.html es una pagina de Claude Design y `#trabajo` esta DENTRO del bloque
   <x-dc>. Una sincronizacion desde Design regenera ese bloque entero y se lleva
   lo que este dentro. Asi que las tarjetas se inyectan desde fuera, se
   re-aplican con un MutationObserver colgado del <body> (nunca de una seccion:
   muere con ella), y son idempotentes.

   Y por eso `montar()` tambien APAGA lo que no sea suyo de la rejilla: lo que
   trae el componente son tres tarjetas de relleno que dicen «arrastra aqui la
   captura». Si vuelven con una sincronizacion, se apagan otra vez solas. Un
   marcador de posicion en la pagina que se le ensena a un prospecto cuesta mas
   que cualquier otra cosa de este archivo.

   ── Por que video y no la pieza viva ──────────────────────────────────────

   Ferropalacios y Novatek eran dos <iframe> con la pieza de Claude Design
   corriendo de verdad. Medido en produccion, cada uno costaba 654 KB de
   @babel/standalone + 92 KB de JSX compilados EN EL NAVEGADOR + medio mega de
   DOM, y las dos cosas peleaban por el hilo principal con el resto de la
   pagina. Y son peliculas: su propio `OM_SCENES` las declara como una lista de
   tomas y `OM_PLAYBACK` dice `loop`. El MP4 ensena exactamente los mismos
   pixeles —se graba de la pieza, cuadro a cuadro, con
   `lab/guardias/pieza-a-video.mjs`— pero lo decodifica la GPU y no toca el
   hilo principal. La pieza sigue viva y navegable en `piezas/<id>`: es la
   fuente, y es de donde se vuelve a grabar cuando cambie.

   ── Que se descarga y cuando ──────────────────────────────────────────────

   Nada, hasta que hay interes. Los <video> arrancan con `preload="none"` y sin
   cartel siquiera —el cartel se pone cuando la tarjeta entra a cuadro— y el que
   mas se ve es el UNICO que se pone a correr. Uno a la vez, no cinco: son diez
   megas entre todos y un visitante mira una tarjeta, no cinco.

   ── Nada invisible esperando animacion (regla 3) ───────────────────────────

   El estado FINAL de la tarjeta es el estado por omision en el CSS. La entrada
   solo QUITA una clase; si no hay IntersectionObserver, si el frame loop no
   corre, o si el visitante pidio menos movimiento, las tarjetas ya estan
   visibles y completas. */
(function () {
  'use strict';

  var TRABAJOS = [
    {
      id: 'ferropalacios',
      src: 'media/ferropalacios.mp4',
      cartel: 'media/ferropalacios.webp',
      titulo: 'Una ferreteria que vende de noche',
      tituloEn: 'A hardware store that sells at night',
      meta: 'ferropalacios · catalogo y carrito',
      metaEn: 'ferropalacios · catalog and cart',
      // El acento de la propia pieza: la tarjeta lo toma prestado para el filo
      // y la chapa, y asi cada trabajo se anuncia con su propio color.
      tinte: '#e08544',
      grande: true
    },
    {
      id: 'novatek',
      src: 'media/novatek.mp4',
      cartel: 'media/novatek.webp',
      titulo: 'Un inventario que lo lleva un agente',
      tituloEn: 'An inventory an agent runs',
      meta: 'novatek · tablero y agente',
      metaEn: 'novatek · dashboard and agent',
      tinte: '#416180',
      grande: true
    },
    {
      id: 'console',
      src: 'media/work1.mp4',
      cartel: 'media/work1.webp',
      titulo: 'Un tablero que contesta',
      tituloEn: 'A dashboard that answers',
      meta: 'console · agente en vivo',
      metaEn: 'console · live agent',
      tinte: '#4f7ad0'
    },
    {
      id: 'recorrido',
      src: 'media/work2.mp4',
      cartel: 'media/work2.webp',
      titulo: 'Un portafolio que se camina',
      tituloEn: 'A portfolio you walk through',
      meta: '3d en css · cinco cuartos',
      metaEn: 'css 3d · five rooms',
      tinte: '#8a7fd6'
    },
    {
      id: 'teclado',
      src: 'media/work3.mp4',
      cartel: 'media/work3.webp',
      titulo: 'Un sitio que se maneja con teclado',
      tituloEn: 'A site you drive with the keyboard',
      meta: 'menú de comando · cuatro secciones',
      metaEn: 'command menu · four sections',
      tinte: '#5f9ea0'
    }
  ];

  var quieto = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Se reproduce solo donde reproducir solo tiene sentido: raton, pantalla
     ancha, movimiento permitido y sin ahorro de datos pedido. En lo demas la
     tarjeta es su cartel hasta que alguien la toca. */
  function soloCartel() {
    var con = navigator.connection;
    return quieto ||
      (con && (con.saveData === true || /^([23]g|slow-2g)$/.test(con.effectiveType || ''))) ||
      !(window.matchMedia && window.matchMedia('(pointer:fine)').matches) ||
      window.innerWidth < 900;
  }

  /* ── el estilo, una sola vez ─────────────────────────────────────────── */
  function estilo() {
    if (document.getElementById('pz-estilo')) return;
    var s = document.createElement('style');
    s.id = 'pz-estilo';
    s.textContent = [
      '.pz{display:block;position:relative;text-decoration:none;color:inherit;',
      '  grid-column:span 6;cursor:pointer}',
      '@media(min-width:900px){.pz{grid-column:span 2}.pz-grande{grid-column:span 3}}',

      /* El marco. `contain:paint` lo saca del calculo de diseno del resto de la
         pagina: es una caja de tamano fijo y lo de dentro no se sale. */
      /* El cartel entra por una FICHA en el <article>, `--pz-cartel`, no como
         estilo en linea del marco: al cerrar la vista grande el marco pierde
         su atributo `style` entero —es como se deshace el FLIP— y con el se
         habria ido el cartel, dejando la tarjeta en blanco a partir de la
         primera vez que alguien la abriera y la cerrara. */
      '.pz-marco{position:relative;aspect-ratio:16/9;overflow:hidden;',
      '  border:1px solid var(--hair);background-color:var(--panel);',
      '  background-image:var(--pz-cartel,none);background-size:cover;',
      '  background-position:center;background-repeat:no-repeat;',
      '  contain:paint;transition:border-color .35s cubic-bezier(.16,1,.3,1)}',
      '.pz:hover .pz-marco,.pz:focus-visible .pz-marco{border-color:var(--pz-tinte,var(--accent))}',
      '.pz:focus-visible{outline:none}',

      /* El video llena el marco. Los cinco carretes son 16:9 y el marco tambien,
         asi que `cover` no recorta nada: esta ahi por si un carrete futuro
         llega con otra proporcion, para que no deforme.

         Y va TRANSPARENTE hasta que de verdad esta corriendo, con el cartel
         debajo puesto como fondo del marco. Un <video> pausado se queda clavado
         en el cuadro donde estaba, y el primer cuadro de estas dos piezas es su
         placa de apertura: un rectangulo negro y uno blanco. Medido en la
         captura de pagina completa -- las dos tarjetas grandes salian vacias.
         Devolverlo al cartel quitandole la fuente costaria una recarga y un
         error en la consola; fundirlo no cuesta nada. */
      '.pz-v{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;',
      '  display:block;opacity:0;transition:opacity .45s cubic-bezier(.16,1,.3,1)}',
      '.pz-marco.corriendo .pz-v{opacity:1}',

      /* La chapa de «abrir»: aparece al pasar, como en las piezas mismas. */
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
      '  .pz,.pz-marco,.pz-v,.pz-telon,.pz-cerrar,.pz-abrir{transition:none!important}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── quien corre: uno a la vez ───────────────────────────────────────── */
  var vistas = new Map();   // article -> cuanto se ve, de 0 a 1
  var sonando = null;       // el <video> que corre ahora mismo
  var fijado = null;        // el que el raton esta senalando, si hay alguno
  var abierta = null;       // la tarjeta a pantalla completa, si hay alguna

  function fuente(v) {
    if (!v.getAttribute('src')) v.setAttribute('src', v.dataset.src);
  }

  /* El cartel tampoco se pide de entrada: cinco carteles son 400 KB que se
     pagarian antes de que nadie haya bajado a la seccion de trabajo. Se pone
     cuando la tarjeta entra a cuadro. */
  function cartel(art) {
    var m = art.querySelector('.pz-marco');
    if (m && !m.style.getPropertyValue('--pz-cartel')) {
      m.style.setProperty('--pz-cartel', 'url("' + art.dataset.cartel + '")');
    }
  }

  function correr(v) {
    if (!v || sonando === v) return;
    apagar();
    sonando = v;
    fuente(v);
    /* El video no se descubre al pedir `play()`, sino cuando el navegador dice
       que ya esta pintando cuadros. Entre una cosa y otra hay red, y descubrir
       antes ensena el hueco. */
    if (!v.dataset.ligado) {
      v.dataset.ligado = '1';
      v.addEventListener('playing', function () {
        if (sonando === v && v.parentElement) v.parentElement.classList.add('corriendo');
      });
    }
    // `play()` devuelve una promesa que se rompe sola si el navegador decide
    // que no toca (pestana oculta, politica de reproduccion). No es un error.
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  function apagar() {
    if (!sonando) return;
    var v = sonando;
    sonando = null;
    if (v.parentElement) v.parentElement.classList.remove('corriendo');
    try { v.pause(); } catch (e) {}
  }

  /* El carrete que se pone a correr es el que mas centrado esta, y solo si se
     ve de verdad. Uno a la vez: entre los cinco son diez megas, y nadie mira
     cinco tarjetas al mismo tiempo. */
  function repartir() {
    if (abierta || soloCartel()) return;
    if (fijado && fijado.isConnected) { correr(fijado.querySelector('.pz-v')); return; }
    var mejor = null, max = 0.45;
    vistas.forEach(function (r, art) {
      if (art.isConnected && r > max) { max = r; mejor = art; }
    });
    if (mejor) correr(mejor.querySelector('.pz-v'));
    else apagar();
  }

  /* ── abrir / cerrar, con FLIP ────────────────────────────────────────── */

  /* La caja grande conserva 16:9, la misma proporcion que la tarjeta. Asi el
     FLIP es una escala uniforme —nada se estira a mitad de camino— y el video
     llena la caja sin bandas negras arriba y abajo. */
  function cajaGrande() {
    var m = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.045);
    var w = Math.min(window.innerWidth - m * 2, (window.innerHeight - m * 2) * 16 / 9);
    var h = w * 9 / 16;
    return { w: Math.round(w), h: Math.round(h),
             x: Math.round((window.innerWidth - w) / 2),
             y: Math.round((window.innerHeight - h) / 2) };
  }

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

    var art = abierta.art;
    var fin = function () {
      marco.classList.remove('abierta');
      /* Se limpia SOLO lo que puso el FLIP. `removeAttribute('style')` era mas
         corto y se llevaba por delante `--pz-tinte` y `--pz-cartel`, que viven
         en el mismo atributo: la tarjeta volvia sin color y sin cartel a partir
         de la primera vez que alguien la abriera y la cerrara. */
      ['left', 'top', 'width', 'height', 'transformOrigin', 'transition', 'transform']
        .forEach(function (k) { marco.style[k] = ''; });

      // De vuelta a su tarjeta, delante del pie. Si el componente se repinto
      // mientras estaba abierta y la tarjeta ya no existe, el marco se va con
      // ella en vez de quedarse suelto en el <body>.
      if (art && art.isConnected) art.insertBefore(marco, art.querySelector('.pz-pie'));
      else marco.remove();

      hueco.style.display = 'none';
      if (abierta) {
        abierta.telon.remove();
        abierta.boton.remove();
        if (abierta.foco && abierta.foco.focus) abierta.foco.focus();
      }
      abierta = null;
      window.removeEventListener('keydown', alaTecla);
      // De vuelta al reparto normal: el que este centrado sigue corriendo.
      apagar();
      repartir();
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
    var v = art.querySelector('.pz-v');
    if (!marco || !v) return;

    cartel(art);
    var r = marco.getBoundingClientRect();

    // El hueco sostiene el espacio de la tarjeta mientras el marco se va a
    // fixed. Sin el, la rejilla colapsa y la pagina da un brinco.
    var hueco = art.querySelector('.pz-hueco');
    hueco.style.display = 'block';
    hueco.style.height = r.height + 'px';

    var telon = document.createElement('div');
    telon.className = 'pz-telon';
    document.body.appendChild(telon);
    telon.addEventListener('click', cerrar);

    var boton = document.createElement('button');
    boton.className = 'pz-cerrar';
    boton.type = 'button';
    boton.textContent = 'cerrar ✕';
    boton.addEventListener('click', cerrar);
    document.body.appendChild(boton);

    /* El marco se MUDA al <body>, y esto es la corrección del 2026-08-28.
       Estaba `position:fixed` con `z-index:200` contra el telón, que es 199 —
       y aun así el telón salía encima y la pantalla se veía gris entera.
       Motivo: el contenido de la página es `position:relative; z-index:10`, o
       sea un CONTEXTO DE APILAMIENTO. El 200 del marco sólo compite dentro de
       ese contexto; hacia afuera todo el bloque vale 10, y el telón, que cuelga
       del <body>, le gana con su 199. Ningún z-index más alto lo arregla: hay
       que salir del contexto.

       Mover el marco es barato porque lo de dentro ya es un <video>: cambiar de
       padre lo PAUSA y se retoma abajo. La versión de iframes no podía hacerlo
       —un iframe se RECARGA al reparentarlo— y de ahí venía todo el rodeo de
       animar el marco sin tocarlo nunca. Esa restricción se fue con el iframe. */
    document.body.appendChild(marco);

    // Geometria FINAL primero, transformacion inversa despues.
    var g = cajaGrande();
    marco.classList.add('abierta');
    marco.style.left = g.x + 'px';
    marco.style.top = g.y + 'px';
    marco.style.width = g.w + 'px';
    marco.style.height = g.h + 'px';
    marco.style.transformOrigin = '0 0';
    marco.style.transition = 'none';
    marco.style.transform =
      'translate(' + (r.left - g.x) + 'px,' + (r.top - g.y) + 'px) scale(' +
      (r.width / g.w) + ')';

    abierta = { marco: marco, hueco: hueco, telon: telon, boton: boton, foco: art, art: art };
    window.addEventListener('keydown', alaTecla);
    document.documentElement.style.overflow = 'hidden';

    // Abrir es la senal mas clara de interes que hay: este es el que suena,
    // aunque el reparto por centrado dijera otra cosa.
    correr(v);
    /* Y si YA era el que sonaba, `correr` sale por la puerta de atras sin hacer
       nada — pero la mudanza al <body> lo acaba de pausar. Se retoma a mano, o
       la pieza se abre a pantalla completa y se queda congelada. */
    if (sonando === v && v.paused) {
      var reanudar = v.play();
      if (reanudar && reanudar.catch) reanudar.catch(function () {});
    }

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

  /* ── montaje ─────────────────────────────────────────────────────────── */
  function tarjeta(p, i) {
    var art = document.createElement('article');
    art.className = 'pz entra' + (p.grande ? ' pz-grande' : '');
    art.setAttribute('data-pz', p.id);
    art.setAttribute('data-cursor', 'ver trabajo');
    art.setAttribute('tabindex', '0');
    art.setAttribute('role', 'button');
    art.setAttribute('aria-label', p.titulo);
    art.dataset.cartel = p.cartel;
    art.style.transitionDelay = (i * 0.09) + 's';

    art.innerHTML =
      '<div class="pz-hueco" style="display:none"></div>' +
      /* El tinte va en el MARCO, no en el articulo: al abrirse el marco se muda
         al <body> y alli ya no hereda las fichas de su tarjeta. */
      '<div class="pz-marco" style="--pz-tinte:' + p.tinte + '">' +
        '<video class="pz-v" muted loop playsinline preload="none" tabindex="-1" ' +
          'aria-hidden="true" data-src="' + p.src + '"></video>' +
        '<span class="pz-abrir">abrir ↗</span>' +
      '</div>' +
      '<div class="pz-pie"><b data-en="' + p.tituloEn + '">' + p.titulo + '</b>' +
      '<i data-en="' + p.metaEn + '">' + p.meta + '</i></div>';

    art.addEventListener('click', function () { abrir(art); });
    art.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(art); }
    });
    // Senalar una tarjeta manda sobre el centrado: si el raton la eligio, esa
    // es la que corre.
    art.addEventListener('pointerenter', function () { fijado = art; repartir(); });
    art.addEventListener('pointerleave', function () {
      if (fijado === art) { fijado = null; repartir(); }
    });
    return art;
  }

  function montar() {
    var seccion = document.getElementById('trabajo');
    if (!seccion) return;
    var rejilla = seccion.querySelector('div[style*="grid-template-columns"]');
    if (!rejilla) return;

    estilo();

    /* Lo que no es nuestro se apaga, en CADA pasada y antes de cualquier otra
       cosa. El componente trae tres tarjetas de relleno que dicen «arrastra
       aqui la captura»; si una sincronizacion desde Design las devuelve, se
       vuelven a apagar solas.

       Se OCULTAN, no se borran: esos nodos los creo React y siguen en su arbol.
       Arrancarlos del DOM es dejarle referencias a nodos sueltos y arriesgar un
       `insertBefore` contra un nodo que ya no esta en la pagina. Ocultarlos no
       le quita nada a nadie y consigue lo mismo. */
    Array.prototype.slice.call(rejilla.children).forEach(function (n) {
      if (n.classList.contains('pz')) return;
      n.style.display = 'none';
      n.setAttribute('aria-hidden', 'true');
    });

    // Idempotente: el componente se repinta solo y esto corre en cada pasada
    // del observador. Si las tarjetas ya estan, no hay nada mas que hacer.
    if (rejilla.querySelector('.pz')) return;

    // Un montaje nuevo deja el registro de visibilidad viejo apuntando a
    // tarjetas que ya no estan en la pagina.
    vistas.clear();
    fijado = null;
    apagar();

    // La rejilla del componente es `auto-fit minmax(300px,1fr)`. Se fija a 6
    // columnas: las dos piezas nuevas ocupan media fila cada una y los tres
    // carretes anteriores una tercera parte.
    rejilla.style.gridTemplateColumns = 'repeat(6,minmax(0,1fr))';

    var arts = TRABAJOS.map(tarjeta);
    arts.forEach(function (a) { rejilla.appendChild(a); });

    /* Entrada y vigilancia. El observador SOLO quita `entra` y anota cuanto se
       ve cada tarjeta; si no existe, el bucle de abajo las revela de inmediato
       y la seccion queda en su estado final igual. */
    if ('IntersectionObserver' in window && !quieto) {
      var vivo = false;
      var io = new IntersectionObserver(function (es) {
        vivo = true;
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.remove('entra'); cartel(e.target); }
          vistas.set(e.target, e.intersectionRatio);
        });
        repartir();
      }, { threshold: [0, 0.25, 0.45, 0.7, 0.95] });
      arts.forEach(function (a) { io.observe(a); });
      /* Red de seguridad: si en 2.5 s el observador no ha dado UNA sola senal
         —contexto que no compone, pestana en segundo plano— se hace a mano lo
         que el iba a hacer: revelar las tarjetas y ponerles su cartel. Se le
         pone a las cinco, no solo a las que estan en pantalla: sin observador
         no hay nadie que se lo ponga a las demas al llegar, y cinco cajas
         vacias son peores que 400 KB. Si el observador SI vive, no se toca
         nada: el ya reparte los carteles segun quien va llegando. */
      setTimeout(function () {
        arts.forEach(function (a) { a.classList.remove('entra'); });
        if (!vivo) arts.forEach(cartel);
      }, 2500);
    } else {
      arts.forEach(function (a) { a.classList.remove('entra'); cartel(a); });
    }

    if (!montar.ligado) {
      montar.ligado = true;
      window.addEventListener('resize', function () {
        // Abierta y con la ventana cambiando de tamano: la caja calculada deja
        // de cuadrar con la pantalla, asi que se cierra en vez de quedar torcida.
        if (abierta) cerrar();
        else repartir();
      });
      // Una pestana en segundo plano no tiene por que estar decodificando video.
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) apagar(); else repartir();
      });
    }
  }

  /* ── la puerta del agente ────────────────────────────────────────────── */

  /* `mostrar_trabajo` del worker devuelve `{tipo:'carrete', proyecto:'001'|
     '002'|'003'}` -- los ids de la portada anterior. Se traducen aqui y se
     vuelve a validar contra las tarjetas que de verdad se montaron: lo que
     viene del modelo NO elige un nodo del DOM sin pasar por esta lista. Mismo
     contrato que `nervReel.abrir` en la portada vieja, para que el worker no
     tenga que saber en que cara esta cayendo.

     Ferropalacios y Novatek estan en la lista pero el agente todavia no los
     puede pedir: su enum sigue siendo de tres. Ampliarlo es tocar las
     herramientas del agente publico, o sea un cambio de seguridad -- va con su
     pasada de `auditor-rojo`, no de paso. */
  window.nervTrabajos = {
    abrir: function (clave) {
      var mapa = { '001': 'console', '002': 'recorrido', '003': 'teclado',
                   console: 'console', work2: 'recorrido', work3: 'teclado',
                   ferropalacios: 'ferropalacios', novatek: 'novatek' };
      var id = mapa[String(clave || '').trim().toLowerCase()];
      if (!id) return false;
      var art = document.querySelector('.pz[data-pz="' + id + '"]');
      if (!art) return false;
      /* `instant` a proposito: la pagina lleva `scroll-behavior:smooth`, y con
         un desplazamiento suave el rectangulo de partida del FLIP se mide
         mientras la pagina todavia se mueve y la pieza sale de un sitio que ya
         no es. El salto no se ve: el telon lo tapa en el mismo cuadro. */
      art.scrollIntoView({ block: 'center', behavior: 'instant' });
      requestAnimationFrame(function () { abrir(art); });
      setTimeout(function () { abrir(art); }, 80);   // por si rAF no corre
      return true;
    }
  };

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
