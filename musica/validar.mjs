/* Comprueba que el catalogo se sostenga solo, antes de que nadie escriba el
 * motor encima. Cuatro cosas, y ninguna es cuestion de gusto:
 *
 *   1. ids unicos
 *   2. ningun `requiere` apunta a un id que no existe
 *   3. no hay ciclos (si A pide B y B pide A, nadie empieza nunca)
 *   4. todo ejercicio es ALCANZABLE desde una raiz — un nodo cuyo prerrequisito
 *      es inalcanzable esta escrito y muerto
 *
 * Ademas avisa de las cosas que no rompen pero huelen: medidas que no existen
 * en el diccionario, umbrales sin sentido declarado, bloques huerfanos.
 *
 *   node validar.mjs
 */
import { readFile } from 'node:fs/promises';

const cat = JSON.parse(await readFile(new URL('./catalogo.json', import.meta.url), 'utf8'));
const ej = cat.ejercicios;
const por = new Map(ej.map((e) => [e.id, e]));
const fallos = [];
const avisos = [];

// 1. ids unicos
const vistos = new Set();
for (const e of ej) {
  if (vistos.has(e.id)) fallos.push(`id repetido: ${e.id}`);
  vistos.add(e.id);
}

// 2. prerrequisitos que existen
for (const e of ej) {
  for (const r of e.requiere) {
    if (!por.has(r)) fallos.push(`${e.id} pide "${r}", que no existe`);
  }
}

// 3. ciclos, por recorrido en profundidad con marca de "en camino"
const estado = new Map();   // id -> 'andando' | 'listo'
function bajar(id, camino) {
  if (estado.get(id) === 'listo') return;
  if (estado.get(id) === 'andando') {
    fallos.push(`ciclo: ${[...camino, id].join(' -> ')}`);
    return;
  }
  estado.set(id, 'andando');
  for (const r of (por.get(id)?.requiere || [])) bajar(r, [...camino, id]);
  estado.set(id, 'listo');
}
for (const e of ej) bajar(e.id, []);

// 4. alcanzables: se parte de las raices y se abre lo que ya tiene todo cubierto
const abierto = new Set(ej.filter((e) => e.requiere.length === 0).map((e) => e.id));
let crecio = true;
while (crecio) {
  crecio = false;
  for (const e of ej) {
    if (abierto.has(e.id)) continue;
    if (e.requiere.every((r) => abierto.has(r))) { abierto.add(e.id); crecio = true; }
  }
}
for (const e of ej) {
  if (!abierto.has(e.id)) fallos.push(`${e.id} no se alcanza desde ninguna raiz`);
}

// avisos
for (const e of ej) {
  if (!cat.medidas[e.mide]) fallos.push(`${e.id} mide "${e.mide}", que no esta en el diccionario`);
  else if (e.mide !== 'ninguna' && (e.aprobar === null || e.aprobar === undefined)) {
    avisos.push(`${e.id} mide algo pero no dice cuando se aprueba`);
  }
  if (!e.dice || e.dice.length < 20) avisos.push(`${e.id} casi no dice que hacer`);
  if (/pentagrama|tablatura|corchea|negra |semicorchea/i.test(e.dice)) {
    avisos.push(`${e.id} usa vocabulario de partitura en \`dice\` — regla 1`);
  }
}

const bloquesUsados = new Set(ej.map((e) => e.bloque));
const bloquesSesion = new Set(cat.sesion.forma.flatMap((f) => f.de));
for (const b of bloquesUsados) {
  if (!bloquesSesion.has(b)) avisos.push(`el bloque "${b}" no entra en ninguna parte de la sesion`);
}

// parte
const raices = ej.filter((e) => e.requiere.length === 0).map((e) => e.id);
console.log(`ejercicios ....... ${ej.length}`);
console.log(`bloques .......... ${[...bloquesUsados].join(', ')}`);
console.log(`raices ........... ${raices.length}  (${raices.join(', ')})`);
console.log(`alcanzables ...... ${abierto.size} de ${ej.length}`);
console.log('');
if (avisos.length) { console.log('avisos:'); avisos.forEach((a) => console.log('  · ' + a)); console.log(''); }
if (fallos.length) {
  console.log('FALLOS:');
  fallos.forEach((f) => console.log('  ! ' + f));
  process.exit(1);
}
console.log('catalogo integro.');
