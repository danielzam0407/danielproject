/* Sustituto del panel de ajustes de Claude Design.

   Las dos piezas importan `tweaks-panel.jsx` porque en Design traen un panel
   flotante para jugar con el acento, la cuadricula y el motion editor. Aqui eso
   NO va: esto es el portafolio, no el taller. Un panel de ajustes encima de una
   pieza de trabajo la convierte en un experimento a medio hacer.

   Asi que en vez de copiar las ~14 KB del panel real, esto cumple su contrato y
   nada mas: `useTweaks` devuelve los valores por omision y un setter que no
   hace nada, y todos los controles se pintan como null. Las piezas corren
   identicas — usan los valores, no la interfaz — y el visitante nunca ve el
   editor.

   Si algun dia se quiere el panel de verdad en `lab/`, se baja el archivo
   original del proyecto de Design y se sustituye este. Los nombres exportados
   son los mismos, a proposito. */

function useTweaks(defaults) {
  // Congelado: sin el panel no hay quien lo cambie, y un estado que nadie
  // escribe solo agrega un re-render por pieza.
  return [defaults || {}, function () {}];
}

const __nada = function () { return null; };

Object.assign(window, {
  useTweaks,
  TweaksPanel: __nada,
  TweakSection: __nada,
  TweakRow: __nada,
  TweakSlider: __nada,
  TweakToggle: __nada,
  TweakRadio: __nada,
  TweakSelect: __nada,
  TweakText: __nada,
  TweakNumber: __nada,
  TweakColor: __nada,
  TweakButton: __nada,
});
