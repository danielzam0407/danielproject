/* Cambiar la piel del sitio en vivo.
   nerv — https://nervcenter.online

   El agente no escribe marcado ni CSS libre. Sólo mueve las fichas que están
   declaradas aquí abajo, y este archivo es el que decide si un valor entra o
   no. Todo resultado posible es uno que ya estaba aprobado.

   Por qué así y no dándole permiso de escribir HTML:

   - Un agente que puede todo produce, tarde o temprano, algo feo delante de un
     prospecto. Y el criterio visual es justamente lo que no se puede copiar.
   - El agente es público y contesta a desconocidos. Escribir en el DOM abre la
     puerta a que alguien lo convenza de emitir <script>. Aquí lo peor que
     puede lograr es un color raro.

   Los cambios viven en la sesión de quien los pidió. NO se guardan: si se
   guardaran, un solo troll arruinaría el sitio para todos los que llegaran
   después. */

/* Las únicas fichas que existen. Cualquier otra cosa se ignora en silencio. */
const FICHAS = {
  'senal':       'color',
  'senal-suave': 'color',
  'acento':      'color',
  'tinta':       'color',
  'papel':       'color',
  'papel-alto':  'color',
  'tenue':       'color',
  'fondo-hondo': 'color',
  'pulso':       'numero',
  'ruido':       'numero',
};

/* Sólo hexadecimal. Nada de nombres, nada de rgb(), nada de url().
   Es más estricto de lo que CSS permite, a propósito: un valor de propiedad
   personalizada puede arrastrar cosas que no queremos evaluar. */
const HEX = /^#[0-9a-f]{6}$/i;

/** Deja pasar sólo lo que es válido. Devuelve un objeto limpio. */
export function depurar(propuesta) {
  const limpio = {};
  if (!propuesta || typeof propuesta !== 'object') return limpio;
  for (const [nombre, valor] of Object.entries(propuesta)) {
    const tipo = FICHAS[nombre];
    if (!tipo) continue;                       // ficha inventada: fuera
    if (tipo === 'color') {
      const v = String(valor).trim();
      if (HEX.test(v)) limpio[nombre] = v.toLowerCase();
    } else {
      const n = parseFloat(valor);
      if (!isNaN(n)) limpio[nombre] = String(Math.max(0, Math.min(2, n)));
    }
  }
  return limpio;
}

/** Aplica las fichas al documento. Devuelve las que de verdad entraron. */
export function ponerPiel(propuesta) {
  const fichas = depurar(propuesta);
  const raiz = document.documentElement;
  for (const [nombre, valor] of Object.entries(fichas)) {
    raiz.style.setProperty('--' + nombre, valor);
  }
  if (Object.keys(fichas).length) {
    // El canvas de fracture escucha esto para releer la paleta: sin el aviso,
    // el sitio cambia de piel y la tarjeta se queda con la de antes.
    document.dispatchEvent(new CustomEvent('nerv:fichas', { detail: fichas }));
  }
  return fichas;
}

/** Vuelve a como estaba. Se usa cuando alguien dice "regrésalo". */
export function quitarPiel() {
  const raiz = document.documentElement;
  for (const nombre of Object.keys(FICHAS)) {
    raiz.style.removeProperty('--' + nombre);
  }
  document.dispatchEvent(new CustomEvent('nerv:fichas', { detail: null }));
}

/* Pieles de casa. Sirven para dos cosas: probar esto sin agente, y darle al
   agente ejemplos concretos de a qué suena cada palabra. */
export const PIELES = {
  origen: null,                                   // la de siempre

  brutal: {                                       // "más agresivo, más duro"
    'senal': '#ff2d20', 'senal-suave': '#ff7a6e', 'acento': '#ffd60a',
    'tinta': '#0a0a0a', 'papel': '#f2f2f2', 'papel-alto': '#e2e2e2',
    'tenue': '#8a8a8a', 'fondo-hondo': '#000000', 'pulso': '1.4', 'ruido': '0.8',
  },

  quirofano: {                                    // "más limpio, más frío"
    'senal': '#00a3a3', 'senal-suave': '#7fd6d6', 'acento': '#d8f5f0',
    'tinta': '#14202b', 'papel': '#fbfdfd', 'papel-alto': '#eef5f5',
    'tenue': '#a9bcc4', 'fondo-hondo': '#08131a', 'pulso': '0.75', 'ruido': '0',
  },

  ambar: {                                        // "más cálido, más viejo"
    'senal': '#c46b12', 'senal-suave': '#e9a94f', 'acento': '#f5d99b',
    'tinta': '#2b1d0e', 'papel': '#faf4e8', 'papel-alto': '#f0e5d1',
    'tenue': '#bda684', 'fondo-hondo': '#140d05', 'pulso': '0.9', 'ruido': '0.35',
  },
};

/* Se expone en window para que el agente del sitio y la consola puedan
   llamarlo sin importar módulos. */
window.nervPiel = { ponerPiel, quitarPiel, depurar, PIELES };
