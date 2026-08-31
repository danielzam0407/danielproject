/* El oido compartido del proyecto de musica: deteccion de altura y de ataques.
 *
 * Lo cargan el afinador y la sesion, y `prueba-yin.mjs` lo importa TAL CUAL
 * para probarlo — por eso vive en un modulo y no pegado en cada pagina: el
 * motor duplicado ya divergio una vez en este repo y costo caro.
 *
 * Todo lo que hay aqui salio de mediciones, no de gusto. Las fechas estan en
 * los comentarios de cada pieza.
 */

/* La ventana es de 2048 muestras y el retardo maximo que se busca, 720. A
   48 kHz eso llega hasta 66.7 Hz, por debajo del Mi grave (82.4), asi que
   cubre la guitarra entera con margen. El tramo que se compara son 1024
   muestras: 1024+720 = 1744, y cabe en la ventana. */
export const N = 2048, TAU_MAX = 720, W = 1024;
export const UMBRAL = 0.12, TECHO = 0.35;

/* Umbral de silencio, en RMS. 0.0025 son ~-52 dBFS: unos diez decibeles por
   encima del piso de ruido MEDIDO de la interfaz en reposo (-63 dBFS el
   2026-08-30). Mas arriba, una nota tocada suave se tira como silencio. */
export const RUIDO = 0.0025;

export const BLOQUE = 128;   // el paso del hilo de audio; los ataques se miden a este grano

/* La banda util de la guitarra. El pasabajos en 500 no es adorno: sin el, el
   Mi grave brillante se leia +27 cents (los parciales estirados arrastran el
   periodo). El pasaaltos en 55 saca el retumbe bajo el Mi grave. La prueba
   importa estos numeros: cambiar el corte aqui cambia la prueba con el. */
export const CORTE_ALTOS = 55, CORTE_BAJOS = 500, Q_BANDA = 0.707;

const d = new Float32Array(TAU_MAX);

/* YIN. Devuelve 0 si no hay altura clara. El paso que evita el error de
   octava es quedarse con el PRIMER minimo que baja del umbral, no con el mas
   profundo: el mas profundo suele ser el doble del periodo. */
export function yin(x, sr) {
  var acum = 0, tau, j, s, dif;
  d[0] = 1;
  for (tau = 1; tau < TAU_MAX; tau++) {
    s = 0;
    for (j = 0; j < W; j++) { dif = x[j] - x[j + tau]; s += dif * dif; }
    acum += s;
    d[tau] = acum === 0 ? 1 : (s * tau) / acum;
  }
  var t = -1;
  for (j = 2; j < TAU_MAX; j++) {
    if (d[j] < UMBRAL) {
      while (j + 1 < TAU_MAX && d[j + 1] < d[j]) j++;
      t = j; break;
    }
  }
  /* Respaldo: el ataque de una cuerda real es ruidoso y su minimo puede
     quedarse arriba del umbral sin que la nota sea dudosa. Se toma el minimo
     global si es decente, prefiriendo un minimo local ANTERIOR comparable:
     el global suele caer en el doble del periodo, una octava abajo. */
  if (t < 0) {
    var min = 1, mi = -1;
    for (j = 2; j < TAU_MAX; j++) if (d[j] < min) { min = d[j]; mi = j; }
    if (min > TECHO) return 0;
    for (j = 3; j < mi; j++) {
      if (d[j] < d[j - 1] && d[j] <= d[j + 1] && d[j] < min * 1.3) { mi = j; break; }
    }
    t = mi;
  }
  if (t < 1) return 0;
  // Interpolacion parabolica: sin esto la resolucion se topa en el tamano de
  // una muestra, que en la primera cuerda son ~17 cents.
  var mejor = t;
  if (t > 0 && t + 1 < TAU_MAX) {
    var a = d[t - 1], b = d[t], c = d[t + 1];
    var den = 2 * (2 * b - c - a);
    if (den !== 0) mejor = t + (c - a) / den;
  }
  return mejor > 0 ? sr / mejor : 0;
}

/* Segundo paso: la FASE del fundamental. Una cuerda real trae los parciales
   estirados (inarmonicidad) y arrastran el periodo de YIN — medido el
   2026-08-30: +11 a +27 cents en el Mi grave duro segun el filtro.

   Dos intentos que NO funcionaron, para que nadie los repita: re-correr YIN
   sobre la ventana filtrada (el transitorio del filtro en las orillas sesga
   la autocorrelacion: -30 cents), y fase con ventana Hann (sus lobulos dejan
   pasar la imagen de frecuencia negativa, que a 82 Hz esta a solo 5 anchos de
   banda: -2.3 cents). La combinacion que si: fase SIN filtro, con ventana
   Blackman — sus lobulos de -58 dB entierran la imagen y los armonicos sin
   meter ningun transitorio.

   Se mide la fase del fundamental en dos ventanas corridas 512 muestras; el
   avance de fase entre ellas ES la frecuencia. Si el ajuste sale disparatado
   —octava equivocada, nota cortada a media ventana— manda la primera
   lectura. */
export function refinar(x, sr, f) {
  var wf = 2 * Math.PI * f / sr, M = 1536, SALTO = 512;
  function fasor(desde) {
    var re = 0, im = 0, k, u, ang;
    for (k = 0; k < M; k++) {
      u = x[desde + k] * (0.42 - 0.5 * Math.cos(2 * Math.PI * k / M) +
                          0.08 * Math.cos(4 * Math.PI * k / M));
      ang = wf * k;
      re += u * Math.cos(ang); im -= u * Math.sin(ang);
    }
    return Math.atan2(im, re);
  }
  var df = fasor(SALTO) - fasor(0) - wf * SALTO;
  while (df > Math.PI) df -= 2 * Math.PI;
  while (df < -Math.PI) df += 2 * Math.PI;
  var f2 = f + df * sr / (2 * Math.PI * SALTO);
  return (f2 > 60 && f2 < 1400 && Math.abs(1200 * Math.log2(f2 / f)) < 60) ? f2 : f;
}

/* La secuencia completa, que es lo que las paginas deben llamar: primer paso,
   chequeo de rango de guitarra, refinado. Devuelve 0 o Hz. */
export function medir(x, sr) {
  var f = yin(x, sr);
  if (!f || f < 60 || f > 1400) return 0;
  return refinar(x, sr, f);
}

export function rms(x) {
  var s = 0;
  for (var i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

/* Detector de ataques, para los ejercicios de ritmo. Se alimenta con el PICO
   de cada bloque de 128 muestras y su tiempo (el mismo reloj del contexto de
   audio, que es el reloj del metronomo), y devuelve el tiempo del ataque o
   null. Es una funcion pura a proposito: se prueba en node sin navegador.

   La regla: un ataque es un pico que salta 1.9x por encima del FONDO, y el
   fondo es un rastreador de maximo con decaimiento (~68 ms), no una media
   lenta. La media fallaba con corcheas rapidas: la cola de la nota anterior
   levantaba el promedio y el golpe siguiente ya no saltaba lo suficiente —
   medido con dos golpes a 150 ms, el segundo se perdia. Contra el maximo
   decayente si salta, y el sustain sigue sin re-disparar porque el fondo lo
   trae pegado. El refractario de 110 ms evita que un rasgueo cuente doble. */
export function crearDetectorDeAtaques(sr) {
  var REFRACTARIO = Math.ceil(0.110 * sr / BLOQUE);
  var fondo = 0, espera = 0;
  return function (pico, t) {
    var referencia = fondo;
    fondo = Math.max(fondo * 0.96, pico);
    if (espera > 0) { espera--; return null; }
    if (pico > 0.025 && pico > referencia * 1.9) { espera = REFRACTARIO; return t; }
    return null;
  };
}

/* El worklet NO analiza: acarrea. Un paso de YIN son ~737 mil operaciones y el
   hilo de audio tiene 2.7 ms por bloque para todo; el analisis corre en el
   hilo principal. Lo que se gana aqui es cadencia fija —~23 ventanas por
   segundo pase lo que pase— y el tiempo de inicio de cada ventana en el reloj
   del contexto, que es lo que ata los ataques al metronomo.

   Acarrea LOS DOS canales por separado, nunca mezclados. La mezcla a mono era
   la trampa del 2026-08-30: la TEYUN duplica la entrada, y con la fase
   invertida (izq+der)/2 se cancela a si misma — las notas graves desaparecen
   y solo se cuelan los transitorios agudos. */
export const FUENTE_WORKLET = [
  'class Acarreo extends AudioWorkletProcessor {',
  '  constructor(o){ super();',
  '    this.N = o.processorOptions.N;',
  '    this.a = new Float32Array(this.N);',
  '    this.b = new Float32Array(this.N);',
  '    this.i = 0; this.t0 = 0; }',
  '  process(entradas){',
  '    const cs = entradas[0];',
  '    if (!cs || !cs[0]) return true;',
  '    const c0 = cs[0], c1 = cs[1] || cs[0];',
  '    if (this.i === 0) this.t0 = currentTime;',
  '    for (let k = 0; k < c0.length; k++){',
  '      this.a[this.i] = c0[k];',
  '      this.b[this.i] = c1[k];',
  '      this.i++;',
  // Se TRANSFIERE la propiedad del bufer en vez de copiarlo: slice(0)
  // duplicaba 16 KB por ventana en el hilo de audio, que es el unico hilo
  // del proyecto que no tolera pausas del recolector.
  '      if (this.i >= this.N){',
  '        this.port.postMessage({ a: this.a, b: this.b, t0: this.t0 },',
  '          [this.a.buffer, this.b.buffer]);',
  '        this.a = new Float32Array(this.N);',
  '        this.b = new Float32Array(this.N);',
  '        this.i = 0;',
  '        this.t0 = currentTime + (k + 1) / sampleRate;',
  '      }',
  '    }',
  '    return true; }',
  '}',
  "registerProcessor('acarreo', Acarreo);"
].join('\n');

/* Pide el microfono como debe pedirse aqui, y en ningun otro lado: los tres
   interruptores de Chrome apagados EXPLICITAMENTE (vienen encendidos, son de
   videollamada y destrozan la medicion) y SIN channelCount — pedir mono
   obliga a Chrome a mezclar, y esa mezcla es la que cancela la guitarra. */
/* La cadena de filtros de la banda, construida en UN solo lugar. Las dos
   paginas la usan; la prueba de node no puede (no hay WebAudio ahi) pero
   importa los cortes, asi que los numeros no pueden divergir. */
export function conectarCadena(ctx, flujo, nodo) {
  var altos = ctx.createBiquadFilter();
  altos.type = 'highpass'; altos.frequency.value = CORTE_ALTOS; altos.Q.value = Q_BANDA;
  var bajos = ctx.createBiquadFilter();
  bajos.type = 'lowpass'; bajos.frequency.value = CORTE_BAJOS; bajos.Q.value = Q_BANDA;
  var origen = ctx.createMediaStreamSource(flujo);
  origen.connect(altos); altos.connect(bajos); bajos.connect(nodo);
  return {
    desconectar: function () {
      try { origen.disconnect(); } catch (e) {}
      try { altos.disconnect(); } catch (e) {}
      try { bajos.disconnect(); } catch (e) {}
    }
  };
}

/* La aritmetica de notas, una sola vez para las dos paginas y la sesion. */
export const NOMBRES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const CUERDA_HZ = { 6: 82.41, 5: 110.00, 4: 146.83, 3: 196.00, 2: 246.94, 1: 329.63 };
export function midiDeHz(f) { return 69 + 12 * Math.log2(f / 440); }
export function hzDeMidi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function nombreDeMidi(m) {
  return NOMBRES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
}
export function centsEntre(f, ref) { return 1200 * Math.log2(f / ref); }

/* La entrada recordada, compartida entre el afinador y la sesion. Las guardas
   no son adorno: guardar '' pisa la eleccion buena y el afinador vuelve a
   arrancar en "Predeterminado - ...", el alias del microfono interno. */
export function entradaRecordada() {
  try { return localStorage.getItem('afinador-entrada') || ''; } catch (e) { return ''; }
}
export function recordarEntrada(id) {
  try { if (id) localStorage.setItem('afinador-entrada', id); } catch (e) {}
}

/* Llena un <select> con las entradas de audio, conservando la eleccion. Vive
   aqui porque ya estaba copiado en dos paginas y la copia habia perdido el
   caso "sin entradas". */
export async function listarEntradas(sel, preferido) {
  try {
    var quiero = preferido || sel.value || entradaRecordada();
    var ds = (await navigator.mediaDevices.enumerateDevices())
      .filter(function (x) { return x.kind === 'audioinput'; });
    sel.innerHTML = '';
    ds.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x.deviceId;
      o.textContent = x.label || 'entrada sin nombre';
      sel.appendChild(o);
    });
    if (!sel.children.length) { sel.innerHTML = '<option>— sin entradas —</option>'; return; }
    if (quiero) sel.value = quiero;
    if (!sel.value) sel.selectedIndex = 0;
  } catch (e) { /* sin permiso todavia */ }
}

export function pedirEntrada(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
}
