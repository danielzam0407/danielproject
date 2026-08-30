/* Prueba del detector de altura, contra el codigo REAL del afinador.
 *
 * No reimplementa YIN: lo saca de `afinador.html` con todo y sus constantes, y
 * lo corre contra ondas sinteticas de frecuencia conocida — pasadas antes por
 * UNA COPIA de la misma cadena de filtros del grafo (pasaaltos 55 + pasabajos
 * 500), porque eso es lo que el detector recibe en la pagina. Probarlo con la
 * senal cruda seria probar otra cosa.
 *
 * Por que ondas con armonicos y no solo senos: un seno puro es el caso facil.
 * Lo que rompe en la practica es la cuerda REAL pulsada fuerte — brillante,
 * inarmonica (parciales estirados f_h = h*f0*sqrt(1+B*h^2)) y a veces
 * recortada. Medido el 2026-08-30: sin el pasabajos, el Mi grave brillante se
 * leia +27 cents arriba. Estos casos quedan aqui para que no vuelva.
 *
 *   node prueba-yin.mjs
 */
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./afinador.html', import.meta.url), 'utf8');

// Se extraen las constantes y la funcion tal como estan escritas en la pagina.
const consts = html.match(/var N = 2048[^;]*;[\s\S]*?var RUIDO[^;]*;/);
const fn = html.match(/function yin\(x, sr\) \{[\s\S]*?\n  \}/);
const fn2 = html.match(/function refinar\(x, sr, f\) \{[\s\S]*?\n  \}/);
if (!consts || !fn || !fn2) {
  console.error('no se pudo extraer el detector de afinador.html — cambio la forma del archivo');
  process.exit(1);
}
const det = new Function(
  consts[0] + '\nvar d = new Float32Array(TAU_MAX);\n' + fn[0] + '\n' + fn2[0] +
  '\nreturn { yin: yin, refinar: refinar };'
)();
// La misma secuencia que la pagina: primer paso, chequeo de rango, refinado.
const yin = function (x, sr) {
  const f = det.yin(x, sr);
  if (!f || f < 60 || f > 1400) return f;
  return det.refinar(x, sr, f);
};

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
const pasaAltos = biquad('highpass', 55, 0.707);
const pasaBajos = biquad('lowpass', 500, 0.707);
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

let fallos = 0, peor = 0;
const filas = [];

function probar(etiqueta, x, esperado, tol) {
  const f = yin(cadena(x), SR);
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
   ES un pelo aguda, no es error del detector. Sin el pasabajos este caso daba
   +27 cents; con el, tiene que caer dentro de 3. */
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

// Fuera del rango util: la pagina lo tira por su chequeo de 60-1400 Hz. Aqui
// solo se comprueba que el detector no lo convierta en una nota de guitarra.
const agudo = yin(cadena(seno(1800)), SR);
const fueraOk = !agudo || agudo > 1400 || agudo < 60;
filas.push(['1800 Hz (fuera)', '1800.00', agudo ? agudo.toFixed(2) : 'sin lectura', '—',
  fueraOk ? 'ok' : 'FALLA']);
if (!fueraOk) fallos++;

const anchos = [22, 10, 12, 9, 6];
const linea = (c) => c.map((v, i) => String(v).padEnd(anchos[i])).join(' ');
console.log(linea(['caso', 'esperado', 'leido', 'cents', 'ok']));
console.log('-'.repeat(anchos.reduce((a, b) => a + b + 1, 0)));
filas.forEach((f) => console.log(linea(f)));
console.log('');
console.log(`peor desviacion: ${peor.toFixed(2)} cents   (tolerancia ${TOL}, cuerdas duras 3.0)`);
if (fallos) { console.log(`FALLOS: ${fallos}`); process.exit(1); }
console.log('detector correcto.');
