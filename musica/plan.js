/* El plan de la sesion: quien decide QUE se practica hoy.
 *
 * Es logica pura a proposito — ni DOM ni audio — para que `prueba-plan.mjs` la
 * corra en node. La regla que lo gobierna esta en el LEEME: el catalogo es el
 * producto; esto solo ESCOGE el siguiente nodo y le ajusta el tamano. Nunca
 * pregunta "¿que quieres practicar hoy?" — propone, y la pagina deja pedir
 * otra cosa.
 *
 * El dia que el agente (DeepSeek) entre aqui, entra REEMPLAZANDO a
 * `elegirSesion` con el mismo contrato: recibe catalogo y bitacora, devuelve
 * una sesion. Todo lo demas queda igual.
 */

/* Las medidas que el motor de hoy SI sabe tomar. Las que faltan —acordes y
   secuencias, que piden oido polifonico— no se esconden: sus ejercicios salen
   en el plan como "aun sin motor" y se pueden marcar sabidos a mano. */
export const MEDIDAS_LISTAS = ['desviacion_ms', 'cents', 'tiempo_ms', 'acierto_pct', 'ninguna'];

/* Presupuesto por bloque de la sesion, en segundos. Salen de la forma de 12
   minutos del catalogo, con un respiro para las pantallas de veredicto. */
const CABE_CALENTAMIENTO = 200;
const CABE_DIA = 380;

export function bitacoraVacia() {
  return { aprobados: {}, sesiones: [], calibracion: null, ultimoBloqueDia: null };
}

function medible(cat, e) {
  return MEDIDAS_LISTAS.indexOf(e.mide) !== -1 && !!cat.medidas[e.mide];
}

function aprobado(bit, id) {
  var a = bit.aprobados[id];
  return !!a && (a.veces > 0 || a.manual === true);
}

export function desbloqueado(bit, e) {
  return e.requiere.every(function (r) { return aprobado(bit, r); });
}

/* El bpm de hoy para un ejercicio: el de su ficha mas lo ganado. La escalera
   sube +4 cuando se aprueba DOS dias distintos seguidos, con techo de +28 —
   subir por aprobar dos veces el mismo dia seria premiar la racha corta. */
export function bpmPara(bit, e) {
  if (!e.ficha || !e.ficha.bpm || typeof e.ficha.bpm !== 'number') return null;
  var a = bit.aprobados[e.id];
  return e.ficha.bpm + (a && a.bpmExtra ? a.bpmExtra : 0);
}

function ultimaVez(bit, id) {
  var a = bit.aprobados[id];
  return a && a.ultimaFecha ? a.ultimaFecha : '';
}

/* Ordena candidatos: primero lo nunca aprobado (en el orden del catalogo, que
   ya es pedagogico), despues lo aprobado mas viejo (mantenimiento). */
function candidatos(cat, bit, bloques) {
  var lista = cat.ejercicios.filter(function (e) {
    return bloques.indexOf(e.bloque) !== -1 && medible(cat, e) && desbloqueado(bit, e);
  });
  var nuevos = lista.filter(function (e) { return !aprobado(bit, e.id); });
  var viejos = lista.filter(function (e) { return aprobado(bit, e.id); })
    .sort(function (a, b) { return ultimaVez(bit, a.id) < ultimaVez(bit, b.id) ? -1 : 1; });
  return nuevos.concat(viejos);
}

function llenar(lista, cabe) {
  var out = [], suma = 0;
  for (var i = 0; i < lista.length; i++) {
    if (suma + lista[i].duracion_s > cabe) continue;
    out.push(lista[i]); suma += lista[i].duracion_s;
    if (out.length >= 3) break;
  }
  return out;
}

/* La sesion de hoy. Deterministica: mismos catalogo+bitacora+fecha, misma
   sesion — sin eso no hay forma de probar nada ni de explicar una propuesta. */
export function elegirSesion(cat, bit, fecha) {
  var calentamiento = llenar(candidatos(cat, bit, ['calentamiento', 'pua']), CABE_CALENTAMIENTO);

  /* El bloque del dia es UNO. Se elige entre los que tienen trabajo medible
     desbloqueado, alternando con el de la ultima sesion para no encasillarse. */
  var bloquesDia = ['ritmo', 'oido', 'acordes', 'cambios', 'power', 'escala'];
  var conTrabajo = bloquesDia.filter(function (b) {
    return candidatos(cat, bit, [b]).length > 0;
  });
  var bloque = conTrabajo[0] || null;
  if (conTrabajo.length > 1 && bit.ultimoBloqueDia === bloque) bloque = conTrabajo[1];
  var dia = bloque ? llenar(candidatos(cat, bit, [bloque]), CABE_DIA) : [];

  /* El cierre hereda la tonalidad del dia; sin tonalidad en el dia, Em, que
     es la primera del catalogo de acordes. */
  var jam = cat.ejercicios.filter(function (e) { return e.id === 'lib-jam'; })[0] || null;
  var tonalidad = 'Em';
  dia.concat(calentamiento).some(function (e) {
    if (e.ficha && e.ficha.tonalidad && e.ficha.tonalidad !== 'hereda_del_dia') {
      tonalidad = e.ficha.tonalidad; return true;
    }
    return false;
  });

  /* Lo que existe pero no se puede medir todavia, con su llave de "ya lo se":
     son los ejercicios de acorde, y bloquean a ritmo entero. Esconderlos seria
     mentir sobre el catalogo. */
  var sinMotor = cat.ejercicios.filter(function (e) {
    return !medible(cat, e) && e.mide !== 'ninguna' &&
      desbloqueado(bit, e) && !aprobado(bit, e.id);
  }).slice(0, 4);

  return {
    fecha: fecha,
    calentamiento: calentamiento,
    bloque: bloque,
    dia: dia,
    jam: jam,
    tonalidad: tonalidad,
    sinMotor: sinMotor
  };
}

/* Registra el resultado de un ejercicio. Devuelve una bitacora NUEVA — la de
   entrada no se toca, para que un error a media sesion no deje el registro a
   medio escribir. */
export function registrar(bit, id, resultado) {
  var b = JSON.parse(JSON.stringify(bit));
  var a = b.aprobados[id] || { veces: 0, bpmExtra: 0, rachaDias: 0, ultimaFecha: null, mejor: null };
  if (resultado.aprobado) {
    a.veces += 1;
    if (resultado.fecha !== a.ultimaFecha) {
      a.rachaDias = a.ultimaAprobada ? a.rachaDias + 1 : 1;
      if (a.rachaDias >= 2) { a.bpmExtra = Math.min(28, (a.bpmExtra || 0) + 4); a.rachaDias = 0; }
    }
    a.ultimaAprobada = true;
  } else {
    a.rachaDias = 0;
    a.ultimaAprobada = false;
  }
  if (resultado.valor !== null && resultado.valor !== undefined) {
    var sentido = resultado.sentido || 'sube';
    if (a.mejor === null ||
        (sentido === 'sube' ? resultado.valor > a.mejor : resultado.valor < a.mejor)) {
      a.mejor = resultado.valor;
    }
  }
  a.ultimaFecha = resultado.fecha;
  a.ultimo = resultado.valor;
  b.aprobados[id] = a;
  return b;
}

/* "Ya me lo se": para los ejercicios sin motor de medicion. Queda marcado como
   manual, no como medido — la diferencia importa el dia que el motor llegue. */
export function marcarSabido(bit, id, fecha) {
  var b = JSON.parse(JSON.stringify(bit));
  b.aprobados[id] = { veces: 0, manual: true, ultimaFecha: fecha, bpmExtra: 0, rachaDias: 0 };
  return b;
}

export function cerrarSesion(bit, sesion, resultados, fecha) {
  var b = JSON.parse(JSON.stringify(bit));
  b.ultimoBloqueDia = sesion.bloque;
  b.sesiones.push({ fecha: fecha, bloque: sesion.bloque, resultados: resultados });
  if (b.sesiones.length > 120) b.sesiones.shift();
  return b;
}
