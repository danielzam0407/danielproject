/* Prueba del oido REAL del proyecto — importa `oido.js`, el mismo modulo que
 * cargan el afinador y la sesion. Ya no extrae funciones por regex: desde que
 * el detector vive en un modulo, probar el archivo ES probar las paginas.
 *
 * Tres partes:
 *   1. guardia de divergencia — ninguna pagina puede llevar su propia copia
 *   2. altura: las senales sinteticas pasan por UNA COPIA de la cadena de
 *      filtros del grafo (pasaaltos 55 + pasabajos 500), porque eso es lo que
 *      el detector recibe en la pagina
 *   3. ataques: el detector de ataques con envolventes sinteticas
 *
 * Los casos de cuerda dura existen porque el 2026-08-30 el detector leia el Mi
 * grave fuerte +27 cents arriba (parciales estirados). Quedan aqui para que no
 * vuelva.
 *
 *   node prueba-yin.mjs
 */
import { readFile } from 'node:fs/promises';
import { medir, crearDetectorDeAtaques, BLOQUE, CORTE_ALTOS, CORTE_BAJOS, Q_BANDA } from './oido.js';

let fallos = 0;

/* ── 1 · guardia de divergencia ─────────────────────────────────────────── */
/* Las tres paginas, y no solo el detector: tambien las restricciones del
   microfono. `channelCount` inline fue la falla del 2026-08-30 (la mezcla a
   mono cancelaba la guitarra), y una copia de `echoCancellation` es la senal
   de que alguien esta pidiendo el microfono por fuera de pedirEntrada(). */
for (const pagina of ['afinador.html', 'index.html', 'entradas.html']) {
  let t = null;
  try { t = await readFile(new URL('./' + pagina, import.meta.url), 'utf8'); }
  catch (e) { console.log('FALLA: falta ' + pagina); fallos++; continue; }
  if (!t.includes("from './oido.js'")) {
    console.log('FALLA: ' + pagina + ' no importa oido.js');
    fallos++;
  }
  /* Con dos puntos: es la forma de RESTRICCION (`echoCancellation: false`).
     Leer el ajuste para ensenarlo (`aj.echoCancellation`) es legitimo y hasta
     deseable — el diagnostico del afinador vive de eso. */
  for (const copia of ['function yin(', 'function refinar(', 'registerProcessor(',
                       'channelCount:', 'echoCancellation:']) {
    if (t.includes(copia)) {
      console.log('FALLA: ' + pagina + ' lleva una copia local: ' + copia);
      fallos++;
    }
  }
}

/* ── 2 · altura ─────────────────────────────────────────────────────────── */
const SR = 48000;
const N = 2048;
const LARGO = N * 3;   // se genera de mas y se toma la cola: el arranque del
                       // filtro trae un transitorio que en la pagina no existe

/* Espejo del grafo del afinador: RBJ biquad, pasaaltos 55 + pasabajos 500,
   ambos con Q = 0.707. Si el grafo cambia, esto cambia con el. */
function biquad(tipo, fc, Q) {
  const w = 2 * Math.PI * fc / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  let b0, b1, b2;
  if (tipo === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
  else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  return function (x) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
}
// Los cortes vienen del modulo: si el grafo cambia, la prueba cambia con el.
const pasaAltos = biquad('highpass', CORTE_ALTOS, Q_BANDA);
const pasaBajos = biquad('lowpass', CORTE_BAJOS, Q_BANDA);
function cadena(x) { return pasaBajos(pasaAltos(x)).slice(LARGO - N); }

/* Una cuerda: fundamental mas armonicos que decaen. `brillo` sube el peso de
   los armonicos altos; `B` es la inarmonicidad (parciales estirados, la fisica
   real de una cuerda de acero: tipico 1e-4 a 5e-4); `drive` > 0.5 recorta. */
function cuerda(f0, opciones) {
  const o = opciones || {};
  const B = o.B || 0, brillo = o.brillo || 1, nA = o.armonicos || 8, drive = o.drive || 0.5;
  const x = new Float32Array(LARGO);
  for (let h = 1; h <= nA; h++) {
    const fh = h * f0 * Math.sqrt(1 + B * h * h);
    const amp = Math.pow(h, -1.4 / brillo);
    const fase = (h * 7919) % 100 / 100 * Math.PI * 2;   // fases fijas, sin azar
    for (let i = 0; i < LARGO; i++) {
      x[i] += amp * Math.sin(2 * Math.PI * fh * i / SR + fase);
    }
  }
  let max = 0;
  for (let i = 0; i < LARGO; i++) max = Math.max(max, Math.abs(x[i]));
  for (let i = 0; i < LARGO; i++) {
    x[i] = Math.max(-0.5, Math.min(0.5, x[i] / max * drive));
  }
  return x;
}

function seno(f0) {
  const x = new Float32Array(LARGO);
  for (let i = 0; i < LARGO; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f0 * i / SR);
  return x;
}

const cents = (a, b) => 1200 * Math.log2(a / b);

const CUERDAS = [
  ['6·Mi', 82.41], ['5·La', 110.00], ['4·Re', 146.83],
  ['3·Sol', 196.00], ['2·Si', 246.94], ['1·Mi', 329.63]
];

// Tolerancia: 5 cents es el umbral con el que se aprueba `oid-afinar` en el
// catalogo, asi que el detector tiene que ser bastante mejor que eso.
const TOL = 2.0;

let peor = 0;
const filas = [];

function probar(etiqueta, x, esperado, tol) {
  const f = medir(cadena(x), SR);
  const lim = tol || TOL;
  if (!f) { filas.push([etiqueta, esperado.toFixed(2), 'sin lectura', '—', 'FALLA']); fallos++; return; }
  const err = cents(f, esperado);
  peor = Math.max(peor, Math.abs(err));
  const ok = Math.abs(err) <= lim;
  if (!ok) fallos++;
  filas.push([etiqueta, esperado.toFixed(2), f.toFixed(2),
    (err >= 0 ? '+' : '') + err.toFixed(2), ok ? 'ok' : 'FALLA']);
}

for (const [n, f] of CUERDAS) probar(n + ' · seno', seno(f), f);
for (const [n, f] of CUERDAS) probar(n + ' · pulsada', cuerda(f), f);
// Brillante = mucho armonico: el caso que produce el error de octava.
for (const [n, f] of CUERDAS) probar(n + ' · brillante', cuerda(f, { brillo: 2.2, armonicos: 14 }), f);

/* La cuerda DURA: inarmonica, brillante y pulsada con ganas. El "esperado" es
   el primer parcial f0*sqrt(1+B) — con parciales estirados la nota que suena
   ES un pelo aguda, no es error del detector. */
for (const [n, f] of [['6·Mi', 82.41], ['5·La', 110.00]]) {
  const B = 3e-4;
  probar(n + ' · dura (B=3e-4)', cuerda(f, { B: B, brillo: 2.2, armonicos: 14 }),
    f * Math.sqrt(1 + B), 3.0);
  probar(n + ' · dura recortada', cuerda(f, { B: B, brillo: 2.2, armonicos: 14, drive: 1.4 }),
    f * Math.sqrt(1 + B), 3.0);
}

// Desafinada a proposito: el afinador tiene que seguirla, no redondearla.
probar('5·La −33¢', cuerda(110 * Math.pow(2, -33 / 1200)), 110 * Math.pow(2, -33 / 1200));
probar('3·Sol +41¢', cuerda(196 * Math.pow(2, 41 / 1200)), 196 * Math.pow(2, 41 / 1200));

// Fuera del rango util: medir() lo tira entero (el chequeo vive en el modulo).
const agudo = medir(cadena(seno(1800)), SR);
filas.push(['1800 Hz (fuera)', '1800.00', agudo ? agudo.toFixed(2) : 'se callo', '—',
  agudo === 0 ? 'ok' : 'FALLA']);
if (agudo !== 0) fallos++;

const anchos = [22, 10, 12, 9, 6];
const linea = (c) => c.map((v, i) => String(v).padEnd(anchos[i])).join(' ');
console.log(linea(['caso', 'esperado', 'leido', 'cents', 'ok']));
console.log('-'.repeat(anchos.reduce((a, b) => a + b + 1, 0)));
filas.forEach((f) => console.log(linea(f)));

/* ── 3 · ataques ────────────────────────────────────────────────────────── */
/* Se alimenta el detector con envolventes de PICO por bloque, como hace la
   sesion. Un ataque real: salto brusco y decaimiento exponencial. */
function correrAtaques(picos) {
  const det = crearDetectorDeAtaques(SR);
  const vistos = [];
  for (let i = 0; i < picos.length; i++) {
    const t = det(picos[i], i * BLOQUE / SR);
    if (t !== null) vistos.push(t);
  }
  return vistos;
}
function envolvente(duracionS, ataquesEn, pico) {
  const nB = Math.round(duracionS * SR / BLOQUE);
  const e = new Float32Array(nB).fill(0.002);   // piso de ruido
  for (const t of ataquesEn) {
    const b0 = Math.round(t * SR / BLOQUE);
    for (let k = 0; k < 200 && b0 + k < nB; k++) {
      e[b0 + k] = Math.max(e[b0 + k], pico * Math.exp(-k / 60));
    }
  }
  return e;
}

const casosAtaque = [];
{
  // cuatro golpes limpios cada 0.5 s: cuatro detecciones, en su lugar
  const esperados = [0.5, 1.0, 1.5, 2.0];
  const v = correrAtaques(envolvente(2.6, esperados, 0.3));
  const ok = v.length === 4 && v.every((t, i) => Math.abs(t - esperados[i]) < 0.01);
  casosAtaque.push(['4 golpes cada 500 ms', v.length + ' detectados', ok]);
}
{
  // un solo golpe con sustain largo: UNA deteccion, no re-dispara
  const v = correrAtaques(envolvente(2.0, [0.3], 0.4));
  casosAtaque.push(['golpe con sustain', v.length + ' detectados', v.length === 1]);
}
{
  // dos golpes a 150 ms (corcheas rapidas): DOS detecciones, el refractario no se los come
  const v = correrAtaques(envolvente(1.0, [0.3, 0.45], 0.3));
  casosAtaque.push(['dos a 150 ms', v.length + ' detectados', v.length === 2]);
}
{
  // puro ruido de piso: cero detecciones
  const v = correrAtaques(envolvente(2.0, [], 0));
  casosAtaque.push(['solo ruido', v.length + ' detectados', v.length === 0]);
}
{
  // golpe suave por debajo del piso absoluto: cero — mejor callar que inventar
  const v = correrAtaques(envolvente(1.0, [0.3], 0.015));
  casosAtaque.push(['golpe demasiado suave', v.length + ' detectados', v.length === 0]);
}

console.log('');
console.log('ataques:');
for (const [n, r, ok] of casosAtaque) {
  console.log('  ' + n.padEnd(26) + r.padEnd(16) + (ok ? 'ok' : 'FALLA'));
  if (!ok) fallos++;
}

console.log('');
console.log(`peor desviacion de altura: ${peor.toFixed(2)} cents   (tolerancia ${TOL}, cuerdas duras 3.0)`);
if (fallos) { console.log(`FALLOS: ${fallos}`); process.exit(1); }
console.log('oido correcto.');
