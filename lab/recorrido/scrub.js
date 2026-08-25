/* Motor de recorrido ligado al scroll.
   nerv — https://nervcenter.online

   Liga la posición del scroll al cuadro de un video. La idea es la de un
   editor: el scroll es la cabeza lectora y el video es la línea de tiempo.

   Lo medido el 2026-08-25 en celular, y por qué este archivo está así:

   - Un video normal tarda ~407 ms (p90) en saltar a un cuadro cualquiera,
     porque sólo trae 4 keyframes en 615 cuadros. Inservible.
   - El MISMO video reencodeado con `-g 1` baja a 30 ms. Trece veces mejor.
     Este motor DA POR HECHO que el video viene así:

       ffmpeg -i entrada.mp4 -c:v libx264 -g 1 -keyint_min 1 \
              -sc_threshold 0 -crf 32 -preset slow -an \
              -vf "scale=768:-2" salida.mp4

     Con un video normal esto va a verse a tirones y no es culpa del código.

   Las tres decisiones que hacen la diferencia entre fluido y entrecortado:

   1. NO se busca en cada evento de scroll. El scroll dispara decenas de
      eventos por segundo y cada búsqueda encola una decodificación; encimarlas
      atasca el decodificador y el video se queda atrás del dedo. Aquí el
      scroll sólo anota un objetivo y un bucle de rAF hace el trabajo.
   2. NO se busca si el video ya está buscando. Es la misma trampa: pedir el
      cuadro 300 mientras todavía llega el 200 tira el trabajo hecho.
   3. Se interpola hacia el objetivo en vez de saltar. Aunque el dedo se mueva
      a brincos, la cámara avanza suave — que es lo que se siente como calidad.
*/

export function recorrido(opciones) {
  var video = opciones.video;
  var pista = opciones.pista || video.parentElement;
  var suavizado = opciones.suavizado == null ? 0.12 : opciones.suavizado;
  var alCambiar = opciones.alCambiar || null;

  if (!video || !pista) return { destruir: function () {} };

  var objetivo = 0;      // dónde debería estar, según el scroll
  var actual = 0;        // dónde está de verdad, persiguiendo al objetivo
  var buscando = false;
  var vivo = true;
  var lazo = null;

  /* Quien pidió menos movimiento recibe cuadros sueltos, no una cámara que se
     desliza. La pieza sigue contándose completa; sólo deja de moverse sola. */
  var quietud = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  function duracion() {
    return (video.duration && !isNaN(video.duration)) ? video.duration : 0;
  }

  /** Qué tan avanzado va el scroll dentro de la pista: 0 arriba, 1 abajo. */
  function avance() {
    var caja = pista.getBoundingClientRect();
    var recorrible = caja.height - window.innerHeight;
    if (recorrible <= 0) return 0;
    var p = -caja.top / recorrible;
    return p < 0 ? 0 : (p > 1 ? 1 : p);
  }

  function medir() {
    var d = duracion();
    if (!d) return;
    // 0.999 y no 1: pedir exactamente la duración cae fuera del último cuadro
    // en varios navegadores y el video se queda en negro al final del scroll.
    objetivo = avance() * d * 0.999;
    if (quietud.matches) {
      actual = objetivo;
      aplicar();
    }
  }

  function aplicar() {
    if (buscando) return;
    if (Math.abs(video.currentTime - actual) < 0.02) return;
    buscando = true;
    video.currentTime = actual;
  }

  function pintar() {
    if (!vivo) return;
    if (!quietud.matches) {
      actual += (objetivo - actual) * suavizado;
      if (Math.abs(objetivo - actual) < 0.004) actual = objetivo;
      aplicar();
    }
    if (alCambiar) alCambiar(duracion() ? actual / duracion() : 0);
    lazo = requestAnimationFrame(pintar);
  }

  function terminoBusqueda() { buscando = false; }

  video.addEventListener('seeked', terminoBusqueda);
  video.addEventListener('error', terminoBusqueda);
  window.addEventListener('scroll', medir, { passive: true });
  window.addEventListener('resize', medir);

  /* El primer cuadro se pinta SIN esperar al bucle. Es la regla de la casa:
     nada queda invisible esperando una animación — si el rAF no corre (pestaña
     oculta, o un navegador que lo pausa), la pieza ya se ve. */
  function arrancar() {
    medir();
    actual = objetivo;
    aplicar();
    if (!lazo) lazo = requestAnimationFrame(pintar);
  }

  if (duracion()) arrancar();
  else video.addEventListener('loadedmetadata', arrancar, { once: true });

  return {
    destruir: function () {
      vivo = false;
      if (lazo) cancelAnimationFrame(lazo);
      video.removeEventListener('seeked', terminoBusqueda);
      video.removeEventListener('error', terminoBusqueda);
      window.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
    },
    /** Para depurar desde la consola sin adivinar. */
    estado: function () {
      return { objetivo: objetivo, actual: actual, buscando: buscando,
               duracion: duracion(), quietud: quietud.matches };
    }
  };
}
