/* v5 — el acento legible en modo oscuro.
   Va FUERA del bloque <x-dc> a propósito (regla 1 de la casa).

   EL PROBLEMA, MEDIDO

   THEMES (v5.html:478-481) define cinco fichas: --bg, --fg, --dim, --panel y
   --hair. NO define --accent. Y setTheme() hace `Object.keys(t).forEach`, o sea
   que sólo reescribe las llaves que existen. Al pasar a oscuro el acento se
   queda con el valor del modo claro:

       #1c3bf0 sobre #eceff5 (fondo claro)  = 6.22:1   pasa
       #1c3bf0 sobre #07080c (fondo oscuro) = 2.80:1   NO pasa
       #1c3bf0 sobre #0f1116 (panel oscuro) = 2.64:1   NO pasa

   El azul se usa en enlaces, en el rótulo del agente y en la palabra que rota
   del titular. En modo oscuro, todo eso es texto de leer por debajo del mínimo.

   POR QUÉ ES UN SCRIPT Y NO UNA LÍNEA DE CSS

   Porque el valor correcto no se puede cocinar: **el agente cambia --accent en
   vivo**. Un prospecto le escribe "ponlo verde" y la página obedece — ésa es la
   demostración del producto. Un color fijo en una hoja se desincroniza en el
   primer cambio, y peor: se desincroniza justo mientras el cliente está
   mirando. Así que se calcula sobre el acento que HAYA, cada vez.

   CÓMO SE PORTA
   · Sólo actúa en modo oscuro, y sólo si el acento de verdad no pasa 4.5:1.
     Si ya pasa, no toca nada.
   · Guarda el acento original y lo restituye al volver a claro: nunca se
     encadenan dos aclarados sobre el mismo color.
   · Es idempotente y se vuelve a aplicar solo, con un MutationObserver colgado
     del <body> — nunca de una sección, que muere en el repintado (regla 2).
   · Marca :root[data-acento-aclarado] para que v5-pulido.css pueda voltear a
     oscura la tinta que va ENCIMA del acento. Sin eso, texto claro sobre un
     acento ya claro. */

(function () {
  'use strict';

  var MINIMO = 4.5;          // el umbral de lectura de WCAG AA
  var raiz = document.documentElement;
  var original = null;       // el acento tal como lo dejó quien lo puso
  var escrito = null;        // lo último que escribimos NOSOTROS
  var dentro = false;        // candado contra la mordida propia (ver abajo)

  function aCanal(hex) {
    var h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function aHex(c) {
    return '#' + c.map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    }).join('');
  }

  /* Luminancia relativa de WCAG. La curva no es lineal: por eso no sirve
     comparar los canales a ojo ni promediarlos. */
  function luminancia(c) {
    var l = c.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }

  function contraste(a, b) {
    var la = luminancia(a), lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function ficha(nombre) {
    return getComputedStyle(raiz).getPropertyValue(nombre).trim();
  }

  /* Escribir el acento pasa por aquí SIEMPRE. El observador vigila el `style`
     del <html> y este script escribe en ese mismo `style`: sin candado se
     llamaría a sí mismo para siempre y dejaría el procesador del teléfono
     pegado al techo. Se apunta además lo escrito, que es como después se
     distingue "lo puse yo" de "lo cambió el agente". */
  function ponerAcento(hex) {
    dentro = true;
    escrito = hex;
    raiz.style.setProperty('--accent', hex);
    dentro = false;
  }

  function restituir() {
    if (original) { ponerAcento(original); original = null; }
    escrito = null;
    raiz.removeAttribute('data-acento-aclarado');
  }

  function aplicar() {
    if (dentro) return;                        // es nuestra propia escritura rebotando
    var oscuro = raiz.getAttribute('data-tema') === 'oscuro';
    var vivo = ficha('--accent');
    var acento = aCanal(vivo);
    if (!acento) return;                       // acento en un formato que no leo: no toco nada

    /* Si el acento vivo NO es el que escribimos, alguien más lo movió — el
       agente, casi siempre, que es el producto funcionando. Ese pasa a ser el
       acento de autor y lo anterior se olvida. Sin esto, un cambio del agente
       en modo oscuro se perdería en el siguiente repintado. */
    if (escrito && vivo.toLowerCase() !== escrito.toLowerCase()) {
      original = null;
      escrito = null;
    }

    if (!oscuro) {
      /* De vuelta a claro: se restituye lo guardado. Si no, un ida y vuelta
         dejaría el acento aclarado sobre fondo claro — el error contrario. */
      restituir();
      return;
    }

    /* Se mide contra la superficie MÁS EXIGENTE de las dos, no contra el fondo
       nada más: el acento se usa igual sobre el panel de las tarjetas, y ahí el
       contraste es siempre peor. */
    var fondo = aCanal(ficha('--bg')) || [0, 0, 0];
    var panel = aCanal(ficha('--panel')) || fondo;
    var peor = function (c) { return Math.min(contraste(c, fondo), contraste(c, panel)); };

    /* El color a juzgar es el DE AUTOR, no el que está puesto: si ya lo
       aclaramos, el puesto pasa de sobra y saldríamos por la rama de "ya pasa"
       para restituir el original, que vuelve a fallar, que se vuelve a aclarar.
       Ese vaivén es el bucle infinito con otro disfraz. */
    var autor = original ? (aCanal(original) || acento) : acento;

    if (peor(autor) >= MINIMO) {
      /* Ya pasa por sí solo — el agente pudo haber puesto un color claro. */
      restituir();
      return;
    }

    if (!original) original = aHex(acento);    // se guarda ANTES de tocarlo

    /* Se mezcla hacia blanco en pasos chicos y se para en el primero que pasa.
       Mezclar conserva el tono: sigue siendo su azul, más claro. Subir la
       luminosidad por otro camino (HSL) le cambiaría el matiz. */
    var base = aCanal(original) || acento, elegido = null;
    for (var t = 0.05; t <= 1.0001; t += 0.05) {
      var m = base.map(function (c) { return c + (255 - c) * t; });
      if (peor(m) >= MINIMO) { elegido = m; break; }
    }
    if (!elegido) elegido = [255, 255, 255];   // ni el blanco pasaría: caso imposible, pero sin ramas muertas no se sabe

    var nuevo = aHex(elegido);
    if (nuevo !== escrito) ponerAcento(nuevo); // si ya está puesto, ni se toca
    raiz.setAttribute('data-acento-aclarado', '');
  }

  /* Se vuelve a aplicar cuando cambie el tema o el acento. Los dos viven en el
     <html>: data-tema como atributo y --accent dentro de su `style`. */
  new MutationObserver(aplicar).observe(raiz, {
    attributes: true,
    attributeFilter: ['data-tema', 'style'],
  });

  /* Y un observador del <body>, que es lo que manda la regla 2: el componente
     se repinta entero y hay que reaplicar. Colgarlo de una sección no serviría
     — la sección muere en el repintado y se lleva el observador. */
  if (document.body) {
    new MutationObserver(aplicar).observe(document.body, { childList: true, subtree: true });
  }

  aplicar();
  document.addEventListener('DOMContentLoaded', aplicar);
})();
