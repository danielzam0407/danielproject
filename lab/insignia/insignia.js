/* ═══════════════════════════════════════════════════════════════════════════
   INSIGNIA — los elementos que no caben en CSS.
   nerv — https://nervcenter.online

   Nueve generadores. Todos DETERMINISTAS: la misma semilla da siempre el
   mismo dibujo. Eso importa porque un adorno que cambia en cada recarga es
   ruido; uno que no cambia es una marca.

   Todos IDEMPOTENTES: se marcan con data-ins y volver a llamarlos no duplica
   nada. El componente del sitio se repinta solo, y esto tiene que sobrevivirlo.

   Ninguno depende del bucle de animación: lo que dibujan queda dibujado en la
   primera llamada, síncrona. (Regla de la casa: nada invisible esperando una
   animación que puede no correr nunca.)
   ═══════════════════════════════════════════════════════════════════════════ */

/** xorshift32. El mismo que usa el motor del sitio: barato y reproducible. */
function dado(semilla) {
  let s = (typeof semilla === 'string' ? hash(semilla) : semilla) >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function hash(txt) {
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** El color de una ficha, resuelto de verdad. Si piel.js repintó el sitio,
    esto devuelve el color nuevo — el canvas no hereda variables CSS. */
function ficha(nombre, respaldo) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--' + nombre).trim();
  return v || respaldo;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function nodo(tag, atributos) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in atributos) e.setAttribute(k, atributos[k]);
  return e;
}

/* ═══ 1 · TELEMETRÍA ══════════════════════════════════════════════════════
   Lecturas de coordenadas sembradas por toda la caja. NO se leen: se
   perciben. La cifra es falsa pero el sistema no: x crece hacia la derecha,
   y hacia abajo, y cada lectura corresponde a DÓNDE está puesta. Un número
   al azar se nota; uno que corresponde, no. */

export function telemetria(caja, opciones) {
  if (!caja || caja.getAttribute('data-ins-telem')) return;
  caja.setAttribute('data-ins-telem', '1');

  const o = opciones || {};
  const cuantas = o.cuantas || 34;
  const r = dado(o.semilla || 'telemetria');
  const ancho = o.ancho || 2400;   // el sistema de coordenadas declarado
  const alto  = o.alto  || 4200;

  if (getComputedStyle(caja).position === 'static') caja.style.position = 'relative';

  const capa = document.createElement('div');
  capa.className = 'ins-capa-telem';
  /* aria-hidden porque es LITERALMENTE textura: un lector de pantalla leyendo
     cuarenta y seis pares de coordenadas falsas es una tortura, y no aporta
     nada — la doctrina dice que estas cifras no se leen, se perciben. */
  capa.setAttribute('aria-hidden', 'true');
  capa.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';

  for (let i = 0; i < cuantas; i++) {
    const px = r(), py = r();
    const s = document.createElement('span');
    s.className = 'ins-telemetria' + (r() > 0.45 ? ' ins-encorchetada' : '');
    s.style.cssText = 'position:absolute;left:' + (px * 96).toFixed(2) + '%;top:' +
                      (py * 97).toFixed(2) + '%;';
    s.textContent = 'x: ' + Math.round(px * ancho) + '  y: ' + Math.round(py * alto);
    capa.appendChild(s);
  }
  caja.appendChild(capa);
  return capa;
}

/* ═══ 2 · RÁFAGA ══════════════════════════════════════════════════════════
   El elemento firma. Cientos de curvas que salen de un nudo y se abren hacia
   afuera, con un puñado convertidas en cintas pálidas. Es 3D sin ser 3D: la
   convergencia hace el espacio, no la sombra.

   Se dibuja UNA vez, síncrona. No hay bucle. */

export function rafaga(lienzo, opciones) {
  if (!lienzo || lienzo.getAttribute('data-ins-rafaga')) return;
  lienzo.setAttribute('data-ins-rafaga', '1');

  const o = opciones || {};
  const r = dado(o.semilla || 'rafaga');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const caja = lienzo.getBoundingClientRect();
  const w = Math.max(1, Math.round(caja.width || o.ancho || 900));
  const h = Math.max(1, Math.round(caja.height || o.alto || 700));

  lienzo.width = Math.round(w * dpr);
  lienzo.height = Math.round(h * dpr);
  const c = lienzo.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  // El nudo: de dónde sale todo. Arriba del centro, como en la referencia.
  const fx = w * (o.fx != null ? o.fx : 0.52);
  const fy = h * (o.fy != null ? o.fy : 0.46);

  const tinta = o.tinta || ficha('tinta', '#08123a');
  const senal = o.senal || ficha('senal', '#0102ec');

  const hilos = o.hilos || 220;
  const cintas = o.cintas || 16;

  /* ── las cintas, primero: van al fondo ───────────────────────────────── */
  for (let i = 0; i < cintas; i++) {
    const ang = r() * Math.PI * 2;
    const largo = (0.55 + r() * 1.5) * Math.max(w, h);
    const grosor = 6 + r() * 46;
    const curva = (r() - 0.5) * 1.5;

    const x1 = fx + Math.cos(ang) * largo;
    const y1 = fy + Math.sin(ang) * largo;
    const mx = fx + Math.cos(ang + curva) * largo * 0.45;
    const my = fy + Math.sin(ang + curva) * largo * 0.45;

    // dos bordes paralelos, rellenos con un gradiente frío
    const n = { x: -Math.sin(ang), y: Math.cos(ang) };
    const g = c.createLinearGradient(fx, fy, x1, y1);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.18, 'rgba(214,224,238,.85)');
    g.addColorStop(0.44, 'rgba(255,255,255,.95)');
    g.addColorStop(0.72, 'rgba(186,201,222,.7)');
    g.addColorStop(1, 'rgba(226,234,246,0)');

    c.beginPath();
    c.moveTo(fx, fy);
    c.quadraticCurveTo(mx, my, x1 + n.x * grosor, y1 + n.y * grosor);
    c.quadraticCurveTo(mx + n.x * grosor * 1.6, my + n.y * grosor * 1.6, fx, fy);
    c.closePath();
    c.fillStyle = g;
    c.fill();

    // el filo: una sola línea sobre el borde de la cinta
    c.beginPath();
    c.moveTo(fx, fy);
    c.quadraticCurveTo(mx, my, x1, y1);
    c.strokeStyle = 'rgba(' + rgbDe(tinta) + ',.30)';
    c.lineWidth = 0.7;
    c.stroke();
  }

  /* ── los hilos: la maraña ────────────────────────────────────────────── */
  for (let i = 0; i < hilos; i++) {
    const ang = r() * Math.PI * 2;
    const largo = (0.12 + Math.pow(r(), 1.7) * 1.7) * Math.max(w, h);
    const curva = (r() - 0.5) * 2.4;
    const abre = (r() - 0.5) * 0.5;   // dispersión del origen: el nudo no es un punto

    const ox = fx + Math.cos(ang + Math.PI / 2) * abre * 34;
    const oy = fy + Math.sin(ang + Math.PI / 2) * abre * 34;
    const x1 = fx + Math.cos(ang) * largo;
    const y1 = fy + Math.sin(ang) * largo;
    const cx = fx + Math.cos(ang + curva) * largo * 0.5;
    const cy = fy + Math.sin(ang + curva) * largo * 0.5;

    c.beginPath();
    c.moveTo(ox, oy);
    c.quadraticCurveTo(cx, cy, x1, y1);
    // los hilos cortos, los del nudo, van más oscuros: es lo que da el peso
    const cerca = 1 - Math.min(1, largo / Math.max(w, h));
    const alfa = 0.10 + cerca * 0.42;
    c.strokeStyle = (r() > 0.94)
      ? 'rgba(' + rgbDe(senal) + ',' + (alfa * 0.9).toFixed(3) + ')'
      : 'rgba(' + rgbDe(tinta) + ',' + alfa.toFixed(3) + ')';
    c.lineWidth = 0.5 + cerca * 0.5;
    c.stroke();
  }

  /* ── los lazos: las elipses largas que cruzan la maraña ──────────────── */
  for (let i = 0; i < 22; i++) {
    const ang = r() * Math.PI;
    const rx = (0.06 + r() * 0.3) * w;
    const ry = (0.02 + r() * 0.12) * h;
    const cx = fx + (r() - 0.5) * w * 0.55;
    const cy = fy + (r() - 0.5) * h * 0.5;
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, ang, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(' + rgbDe(tinta) + ',.22)';
    c.lineWidth = 0.6;
    c.stroke();
  }
  return lienzo;
}

function rgbDe(hex) {
  const h = String(hex).trim().replace('#', '');
  if (h.length !== 6) return '8,18,58';
  const n = parseInt(h, 16);
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}

/* ═══ 3 · ALAMBRE ═════════════════════════════════════════════════════════
   Poliedros y esferas en línea. Proyección ortográfica a mano: no hace falta
   más, y meter una librería 3D por seis aristas sería exactamente lo que este
   proyecto no hace. */

export function alambre(svg, opciones) {
  if (!svg || svg.getAttribute('data-ins-alambre')) return;
  svg.setAttribute('data-ins-alambre', '1');

  const o = opciones || {};
  const tipo = o.tipo || 'esfera';
  const lado = o.lado || 200;
  const gx = (o.girox != null ? o.girox : 0.5), gy = (o.giroy != null ? o.giroy : 0.8);
  svg.setAttribute('viewBox', '0 0 ' + lado + ' ' + lado);

  const g = nodo('g', {
    fill: 'none',
    stroke: o.trazo || 'currentColor',
    'stroke-width': o.grosor || 0.7,
    'vector-effect': 'non-scaling-stroke',
  });

  const cx = lado / 2, cy = lado / 2, R = lado * 0.42;
  const proy = (x, y, z) => {
    // giro en Y, luego en X. Ortográfica: sin perspectiva, como un plano.
    let x1 = x * Math.cos(gy) + z * Math.sin(gy);
    let z1 = -x * Math.sin(gy) + z * Math.cos(gy);
    let y1 = y * Math.cos(gx) - z1 * Math.sin(gx);
    return [cx + x1 * R, cy + y1 * R];
  };

  if (tipo === 'cubo') {
    const v = [];
    for (let i = 0; i < 8; i++) {
      v.push(proy((i & 1 ? 1 : -1) * 0.62, (i & 2 ? 1 : -1) * 0.62, (i & 4 ? 1 : -1) * 0.62));
    }
    const aristas = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
    aristas.forEach(([a, b]) => {
      g.appendChild(nodo('line', { x1: v[a][0], y1: v[a][1], x2: v[b][0], y2: v[b][1] }));
    });
  } else {
    // esfera: meridianos y paralelos, dibujados como polilíneas
    const PASO = 26;
    for (let m = 0; m < 8; m++) {
      const lon = (m / 8) * Math.PI;
      let d = '';
      for (let i = 0; i <= PASO; i++) {
        const lat = -Math.PI / 2 + (i / PASO) * Math.PI;
        const p = proy(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        d += (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
      }
      g.appendChild(nodo('path', { d: d }));
    }
    for (let p = 1; p < 7; p++) {
      const lat = -Math.PI / 2 + (p / 7) * Math.PI;
      let d = '';
      for (let i = 0; i <= PASO * 2; i++) {
        const lon = (i / (PASO * 2)) * Math.PI * 2;
        const q = proy(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        d += (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2);
      }
      g.appendChild(nodo('path', { d: d }));
    }
  }
  svg.appendChild(g);
  return svg;
}

/* ═══ 4 · CÓDIGO DE BARRAS ════════════════════════════════════════════════
   Las barras salen de la cadena, así que dos códigos distintos se ven
   distintos. No codifica nada real y no pretende hacerlo: en la referencia
   tampoco. Es una marca de procedencia, no un producto de tienda. */

export function barras(caja, cadena) {
  if (!caja || caja.getAttribute('data-ins-barras')) return;
  caja.setAttribute('data-ins-barras', '1');

  const txt = String(cadena || 'NERV').toUpperCase();
  const r = dado(txt);
  const tramos = [];
  let x = 0;
  // guardas de inicio
  tramos.push([0, 1, 1], [2, 1, 1]);
  x = 4;
  for (let i = 0; i < txt.length * 7; i++) {
    const ancho = 1 + Math.floor(r() * 3);
    const lleno = r() > 0.42;
    if (lleno) tramos.push([x, ancho, 1]);
    x += ancho + (lleno ? 1 : 0);
  }
  tramos.push([x + 2, 1, 1], [x + 4, 1, 1]);
  const total = x + 6;

  const svg = nodo('svg', {
    viewBox: '0 0 ' + total + ' 40',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  svg.style.cssText = 'display:block;width:100%;height:100%;';
  tramos.forEach(([px, pw]) => {
    svg.appendChild(nodo('rect', { x: px, y: 0, width: pw, height: 40, fill: 'currentColor' }));
  });
  caja.textContent = '';
  caja.appendChild(svg);
  caja.style.backgroundImage = 'none';
  return caja;
}

/* ═══ 5 · BLOQUE QR ═══════════════════════════════════════════════════════ */

export function qr(caja, cadena, lado) {
  if (!caja || caja.getAttribute('data-ins-qr')) return;
  caja.setAttribute('data-ins-qr', '1');
  const n = lado || 11;
  const r = dado(String(cadena || 'nerv'));
  caja.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
  caja.textContent = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const enOjo = (x < 3 && y < 3) || (x > n - 4 && y < 3) || (x < 3 && y > n - 4);
      const borde = (x === 0 || y === 0 || x === n - 1 || y === n - 1);
      const i = document.createElement('i');
      const lleno = enOjo ? (borde || (x === 1 && y === 1) || (x === n - 2 && y === 1) ||
                             (x === 1 && y === n - 2)) : r() > 0.5;
      if (!lleno) i.className = 'v';
      caja.appendChild(i);
    }
  }
  return caja;
}

/* ═══ 6 · MANCHA DE TINTA ═════════════════════════════════════════════════
   Un trazo grueso deformado por turbulencia. En la referencia es tinta que
   se corrió en la fotocopia; aquí es el mismo filtro que usa el papel. */

export function mancha(svg, opciones) {
  if (!svg || svg.getAttribute('data-ins-mancha')) return;
  svg.setAttribute('data-ins-mancha', '1');
  const o = opciones || {};
  const r = dado(o.semilla || 'mancha');
  const w = o.ancho || 120, h = o.alto || 400;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

  const id = 'ins-m-' + Math.floor(r() * 1e9).toString(36);
  const defs = nodo('defs', {});
  const f = nodo('filter', { id: id, x: '-40%', y: '-10%', width: '180%', height: '120%' });
  f.appendChild(nodo('feTurbulence', {
    type: 'fractalNoise', baseFrequency: '0.03 0.12', numOctaves: '4',
    seed: Math.floor(r() * 900), result: 't',
  }));
  f.appendChild(nodo('feDisplacementMap', {
    in: 'SourceGraphic', in2: 't', scale: '46',
    xChannelSelector: 'R', yChannelSelector: 'G',
  }));
  defs.appendChild(f);
  svg.appendChild(defs);

  const g = nodo('g', { filter: 'url(#' + id + ')', fill: o.trazo || 'currentColor' });
  let d = 'M' + (w * 0.46) + ' 8';
  for (let i = 1; i <= 9; i++) {
    const t = i / 9;
    d += ' L' + (w * (0.3 + r() * 0.42)).toFixed(1) + ' ' + (h * t).toFixed(1);
  }
  for (let i = 9; i >= 1; i--) {
    const t = i / 9;
    d += ' L' + (w * (0.42 + r() * 0.36)).toFixed(1) + ' ' + (h * t).toFixed(1);
  }
  d += ' Z';
  g.appendChild(nodo('path', { d: d }));
  svg.appendChild(g);
  return svg;
}

/* ═══ 7 · ESQUIRLAS ═══════════════════════════════════════════════════════
   Fragmentos blancos con filo negro, encima de todo. Cortan la composición
   sin taparla — por eso son blancos y no de color. */

export function esquirlas(svg, opciones) {
  if (!svg || svg.getAttribute('data-ins-esquirlas')) return;
  svg.setAttribute('data-ins-esquirlas', '1');
  const o = opciones || {};
  const r = dado(o.semilla || 'esquirlas');
  const w = o.ancho || 600, h = o.alto || 400;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

  for (let i = 0; i < (o.cuantas || 14); i++) {
    const x = r() * w, y = r() * h;
    const largo = 40 + r() * (w * 0.55);
    const ang = (r() - 0.5) * 2.6;
    const grosor = 2 + r() * 16;
    const px = Math.cos(ang), py = Math.sin(ang);
    const nx = -py, ny = px;
    const d =
      'M' + x.toFixed(1) + ' ' + y.toFixed(1) +
      ' L' + (x + px * largo).toFixed(1) + ' ' + (y + py * largo).toFixed(1) +
      ' L' + (x + px * largo * 0.62 + nx * grosor).toFixed(1) + ' ' +
             (y + py * largo * 0.62 + ny * grosor).toFixed(1) + ' Z';
    svg.appendChild(nodo('path', {
      d: d, fill: '#ffffff', stroke: o.trazo || 'currentColor', 'stroke-width': 0.8,
    }));
  }
  return svg;
}

/* ═══ 8 · MOSAICO ═════════════════════════════════════════════════════════
   La figura destruida en pixeles. Densidad decreciente: sólido arriba,
   disperso abajo, como si se estuviera deshaciendo. */

export function mosaico(caja, opciones) {
  if (!caja || caja.getAttribute('data-ins-mosaico')) return;
  caja.setAttribute('data-ins-mosaico', '1');
  const o = opciones || {};
  const r = dado(o.semilla || 'mosaico');
  const cols = o.columnas || 16, filas = o.filas || 20;
  caja.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  caja.textContent = '';
  for (let y = 0; y < filas; y++) {
    const densidad = 1 - (y / filas) * 0.85;
    for (let x = 0; x < cols; x++) {
      const i = document.createElement('i');
      const centro = 1 - Math.abs(x - cols / 2) / (cols / 2);
      if (r() > densidad * (0.35 + centro * 0.75)) i.style.background = 'transparent';
      else if (r() > 0.78) i.style.background = 'var(--ins-hielo)';
      caja.appendChild(i);
    }
  }
  return caja;
}

/* ═══ 9 · ESCALA GRADUADA ═════════════════════════════════════════════════ */

export function escala(caja, desde, hasta, paso) {
  if (!caja || caja.getAttribute('data-ins-escala')) return;
  caja.setAttribute('data-ins-escala', '1');
  const a = desde || 0, b = hasta != null ? hasta : 1000, p = paso || 5;
  for (let i = 0; i <= p; i++) {
    const s = document.createElement('span');
    s.style.left = ((i / p) * 100).toFixed(2) + '%';
    s.textContent = Math.round(a + ((b - a) * i) / p);
    caja.appendChild(s);
  }
  return caja;
}

/* ═══ MONTAJE ═════════════════════════════════════════════════════════════
   Barre el documento y arma lo que esté marcado. Se puede volver a llamar
   cuantas veces sea: cada generador se salta lo que ya hizo. */

export function montar(raiz) {
  const d = raiz || document;
  d.querySelectorAll('[data-ins="telemetria"]').forEach((e) =>
    telemetria(e, { cuantas: +e.dataset.cuantas || 34, semilla: e.dataset.semilla }));
  d.querySelectorAll('[data-ins="rafaga"]').forEach((e) =>
    rafaga(e, {
      semilla: e.dataset.semilla,
      hilos: +e.dataset.hilos || 220,
      cintas: +e.dataset.cintas || 16,
      fx: e.dataset.fx != null ? +e.dataset.fx : undefined,
      fy: e.dataset.fy != null ? +e.dataset.fy : undefined,
    }));
  d.querySelectorAll('[data-ins="alambre"]').forEach((e) =>
    alambre(e, { tipo: e.dataset.tipo, girox: +e.dataset.girox || 0.5, giroy: +e.dataset.giroy || 0.8 }));
  d.querySelectorAll('[data-ins="barras"]').forEach((e) => barras(e, e.dataset.cadena));
  d.querySelectorAll('[data-ins="qr"]').forEach((e) => qr(e, e.dataset.cadena, +e.dataset.lado || 11));
  d.querySelectorAll('[data-ins="mancha"]').forEach((e) => mancha(e, { semilla: e.dataset.semilla }));
  d.querySelectorAll('[data-ins="esquirlas"]').forEach((e) =>
    esquirlas(e, { semilla: e.dataset.semilla, cuantas: +e.dataset.cuantas || 14 }));
  d.querySelectorAll('[data-ins="mosaico"]').forEach((e) =>
    mosaico(e, { semilla: e.dataset.semilla, columnas: +e.dataset.columnas || 16, filas: +e.dataset.filas || 20 }));
  d.querySelectorAll('[data-ins="escala"]').forEach((e) =>
    escala(e, +e.dataset.desde || 0, +e.dataset.hasta || 1000, +e.dataset.paso || 5));
}

/* La ráfaga y el alambre leen las fichas al dibujar. Si el agente repinta el
   sitio, hay que volver a pintarlos — el canvas no hereda variables CSS. */
document.addEventListener('nerv:fichas', () => {
  document.querySelectorAll('[data-ins="rafaga"]').forEach((e) => {
    e.removeAttribute('data-ins-rafaga');
    rafaga(e, { semilla: e.dataset.semilla, hilos: +e.dataset.hilos || 220 });
  });
});

if (typeof window !== 'undefined') {
  window.nervInsignia = {
    telemetria, rafaga, alambre, barras, qr, mancha, esquirlas, mosaico, escala, montar,
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => montar());
  } else {
    montar();
  }
}
