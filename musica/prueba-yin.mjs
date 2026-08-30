/* Prueba del detector de altura, contra el codigo REAL del afinador.
 *
 * No reimplementa YIN: lo saca de `afinador.html` con todo y sus constantes, y
 * lo corre contra ondas sinteticas de frecuencia conocida. Si alguien toca el
 * algoritmo y lo empeora, esto lo dice.
 *
 * Por que ondas con armonicos y no senos puros: un seno puro es el caso facil.
 * Lo que de verdad rompe a YIN es una senal rica en armonicos —una guitarra—
 * porque el minimo mas profundo cae en el DOBLE del periodo y el detector
 * contesta una octava abajo. Aqui se prueban las dos.
 *
 *   node prueba-yin.mjs
 */
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./afinador.html', import.meta.url), 'utf8');

// Se extraen las constantes y la funcion tal como estan escritas en la pagina.
const consts = html.match(/var N = 2048[^;]*;[\s\S]*?var RUIDO[^;]*;/);
const fn = html.match(/function yin\(x, sr\) \{[\s\S]*?\n  \}/);
if (!consts || !fn) {
  console.error('no se pudo extraer el detector de afinador.html — cambio la forma del archivo');
  process.exit(1);
}
const yin = new Function(
  consts[0] + '\nvar d = new Float32Array(TAU_MAX);\n' + fn[0] + '\nreturn yin;'
)();

const SR = 48000;
const N = 2048;

/* Una cuerda pulsada: fundamental mas armonicos que decaen. `brillo` sube el
   peso de los armonicos altos — es lo que hace una pastilla de puente o una
   distorsion, y es justo donde YIN se equivoca de octava. */
function cuerda(f0, brillo = 1, armonicos = 8) {
  const x = new Float32Array(N);
  for (let h = 1; h <= armonicos; h++) {
    const amp = Math.pow(h, -1.4 / brillo);
    const fase = (h * 7919) % 100 / 100 * Math.PI * 2;   // fases fijas, sin azar
    for (let i = 0; i < N; i++) {
      x[i] += amp * Math.sin(2 * Math.PI * f0 * h * i / SR + fase);
    }
  }
  let max = 0;
  for (let i = 0; i < N; i++) max = Math.max(max, Math.abs(x[i]));
  for (let i = 0; i < N; i++) x[i] = x[i] / max * 0.5;
  return x;
}

function seno(f0) {
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f0 * i / SR);
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

function probar(etiqueta, x, esperado) {
  const f = yin(x, SR);
  if (!f) { filas.push([etiqueta, esperado.toFixed(2), 'sin lectura', '—', 'FALLA']); fallos++; return; }
  const err = cents(f, esperado);
  peor = Math.max(peor, Math.abs(err));
  const ok = Math.abs(err) <= TOL;
  if (!ok) fallos++;
  filas.push([etiqueta, esperado.toFixed(2), f.toFixed(2),
    (err >= 0 ? '+' : '') + err.toFixed(2), ok ? 'ok' : 'FALLA']);
}

for (const [n, f] of CUERDAS) probar(n + ' · seno', seno(f), f);
for (const [n, f] of CUERDAS) probar(n + ' · pulsada', cuerda(f), f);
// Brillante = mucho armonico. Es el caso que produce el error de octava.
for (const [n, f] of CUERDAS) probar(n + ' · brillante', cuerda(f, 2.2, 14), f);
// Desafinada a proposito: el afinador tiene que seguirla, no redondearla.
probar('5·La −33¢', cuerda(110 * Math.pow(2, -33 / 1200)), 110 * Math.pow(2, -33 / 1200));
probar('3·Sol +41¢', cuerda(196 * Math.pow(2, 41 / 1200)), 196 * Math.pow(2, 41 / 1200));
// Fuera del rango util: debe callarse, no inventar.
const agudo = yin(seno(1800), SR);
filas.push(['1800 Hz (fuera)', '1800.00', agudo ? agudo.toFixed(2) : 'sin lectura', '—',
  (!agudo || agudo > 1400) ? 'ok' : 'FALLA']);
if (agudo && agudo <= 1400) fallos++;

const anchos = [16, 10, 12, 9, 6];
const linea = (c) => c.map((v, i) => String(v).padEnd(anchos[i])).join(' ');
console.log(linea(['caso', 'esperado', 'leido', 'cents', 'ok']));
console.log('-'.repeat(anchos.reduce((a, b) => a + b + 1, 0)));
filas.forEach((f) => console.log(linea(f)));
console.log('');
console.log(`peor desviacion: ${peor.toFixed(2)} cents   (tolerancia ${TOL})`);
if (fallos) { console.log(`FALLOS: ${fallos}`); process.exit(1); }
console.log('detector correcto.');
