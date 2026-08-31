/* Prueba del plan de sesion contra el catalogo REAL — importa `plan.js` y
 * `catalogo.json` tal como los usa la pagina.
 *
 *   node prueba-plan.mjs
 */
import { readFile } from 'node:fs/promises';
import {
  elegirSesion, registrar, marcarSabido, cerrarSesion,
  bitacoraVacia, bpmPara, desbloqueado, MEDIDAS_LISTAS
} from './plan.js';

const cat = JSON.parse(await readFile(new URL('./catalogo.json', import.meta.url), 'utf8'));
const por = new Map(cat.ejercicios.map((e) => [e.id, e]));

let fallos = 0;
function ok(nombre, cond, detalle) {
  console.log('  ' + nombre.padEnd(52) + (cond ? 'ok' : 'FALLA' + (detalle ? '  <- ' + detalle : '')));
  if (!cond) fallos++;
}

console.log('plan de sesion:');

/* 1 · desde bitacora vacia: solo raices, un bloque, cabe en tiempo */
{
  const s = elegirSesion(cat, bitacoraVacia(), '2026-08-30');
  ok('propone calentamiento no vacio', s.calentamiento.length > 0);
  ok('nunca propone algo con prerrequisitos pendientes',
    s.calentamiento.concat(s.dia).every((e) => e.requiere.length === 0));
  ok('el bloque del dia es UNO', s.dia.every((e) => e.bloque === s.bloque));
  ok('el calentamiento cabe en su tiempo',
    s.calentamiento.reduce((a, e) => a + e.duracion_s, 0) <= 200);
  ok('el dia cabe en su tiempo',
    s.dia.reduce((a, e) => a + e.duracion_s, 0) <= 380);
  ok('cierra con el jam', s.jam && s.jam.id === 'lib-jam');
  ok('solo medidas con motor', s.calentamiento.concat(s.dia)
    .every((e) => MEDIDAS_LISTAS.includes(e.mide)));
  ok('avisa de lo que no tiene motor (acordes)',
    s.sinMotor.length > 0 && s.sinMotor.every((e) => e.mide === 'cuerdas_limpias'));
  const s2 = elegirSesion(cat, bitacoraVacia(), '2026-08-30');
  ok('deterministica', JSON.stringify(s) === JSON.stringify(s2));
}

/* 2 · aprobar desbloquea a los que siguen */
{
  let bit = bitacoraVacia();
  bit = registrar(bit, 'cal-arana-1234', { aprobado: true, valor: 40, sentido: 'baja', fecha: '2026-08-30' });
  const e = por.get('cal-arana-cuerdas');
  ok('aprobar la arana abre la de seis cuerdas', desbloqueado(bit, e));
  ok('sin aprobarla, la permutacion sigue cerrada', !desbloqueado(bit, por.get('cal-perm-1324')));
}

/* 3 · la escalera de bpm: dos dias seguidos aprobado, no dos veces en un dia */
{
  const e = por.get('pua-alterna-negras');
  let bit = bitacoraVacia();
  bit = registrar(bit, e.id, { aprobado: true, valor: 35, sentido: 'baja', fecha: '2026-08-30' });
  bit = registrar(bit, e.id, { aprobado: true, valor: 33, sentido: 'baja', fecha: '2026-08-30' });
  ok('dos aprobadas el MISMO dia no suben el tempo', bpmPara(bit, e) === e.ficha.bpm);
  bit = registrar(bit, e.id, { aprobado: true, valor: 34, sentido: 'baja', fecha: '2026-08-31' });
  ok('dos dias seguidos aprobado: +4', bpmPara(bit, e) === e.ficha.bpm + 4);
  bit = registrar(bit, e.id, { aprobado: false, valor: 80, sentido: 'baja', fecha: '2026-09-01' });
  ok('fallar corta la racha pero no baja lo ganado', bpmPara(bit, e) === e.ficha.bpm + 4);
}

/* 4 · marcar sabido abre lo que dependia de un acorde */
{
  let bit = bitacoraVacia();
  ok('ritmo arranca cerrado (pide Mi menor)', !desbloqueado(bit, por.get('rit-negras')));
  bit = marcarSabido(bit, 'ac-em', '2026-08-30');
  ok('marcar Mi menor sabido abre el ritmo', desbloqueado(bit, por.get('rit-negras')));
  const s = elegirSesion(cat, bit, '2026-08-30');
  ok('y ritmo ya compite por ser el bloque del dia',
    ['ritmo', 'oido'].includes(s.bloque));
}

/* 5 · el bloque del dia alterna entre sesiones */
{
  let bit = marcarSabido(bitacoraVacia(), 'ac-em', '2026-08-29');
  const s1 = elegirSesion(cat, bit, '2026-08-30');
  bit = cerrarSesion(bit, s1, [], '2026-08-30');
  const s2 = elegirSesion(cat, bit, '2026-08-31');
  ok('no repite el bloque del dia anterior', s1.bloque !== s2.bloque);
}

/* 6 · registrar no muta la bitacora de entrada */
{
  const bit = bitacoraVacia();
  const antes = JSON.stringify(bit);
  registrar(bit, 'cal-arana-1234', { aprobado: true, valor: 1, fecha: '2026-08-30' });
  ok('registrar devuelve una nueva, no toca la vieja', JSON.stringify(bit) === antes);
}

/* 7 · la tonalidad del jam sale del dia */
{
  let bit = bitacoraVacia();
  ['ac-em', 'ac-am'].forEach((id) => { bit = marcarSabido(bit, id, '2026-08-29'); });
  // el catalogo entero, muchas sesiones: la tonalidad siempre es una real
  let b = bit;
  for (let d = 0; d < 8; d++) {
    const s = elegirSesion(cat, b, '2026-09-0' + (d + 1));
    if (s.tonalidad === 'hereda_del_dia') { ok('tonalidad nunca queda sin resolver', false); break; }
    b = cerrarSesion(b, s, [], s.fecha);
    if (d === 7) ok('tonalidad nunca queda sin resolver', true);
  }
}

console.log('');
if (fallos) { console.log('FALLOS: ' + fallos); process.exit(1); }
console.log('plan correcto.');
