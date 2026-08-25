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


/* ---- motor de paleta ---------------------------------------------------

   Enumerar pieles no escala: si alguien dice "morado" y no hay piel morada,
   el agente prefiere no hacer nada. Y ese fue justo el sintoma.

   Aqui la paleta se DERIVA de un color. Las reglas de armonia son fijas y
   son las de la casa; lo unico que pone quien habla es el tono. Sigue siendo
   un sistema cerrado —no puede salir cualquier cosa— pero admite cualquier
   color en vez de cuatro. */

function aHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: sat, l };
}

function aHex(h, s, l) {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x]
          : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return '#' + t.map(v => Math.round((v + m) * 255)
                          .toString(16).padStart(2, '0')).join('');
}

/* Los cuatro animos. No cambian el tono: cambian el CARACTER —cuanto
   contraste, cuanto grano, que tan rapido se mueve. */
const ANIMOS = {
  claro:  { fondoClaro: true,  sat: 1.00, ruido: 0.10, pulso: 1.00 },
  oscuro: { fondoClaro: false, sat: 0.95, ruido: 0.30, pulso: 0.90 },
  duro:   { fondoClaro: false, sat: 1.25, ruido: 0.85, pulso: 1.40 },
  limpio: { fondoClaro: true,  sat: 0.80, ruido: 0.00, pulso: 0.75 },
  calido: { fondoClaro: true,  sat: 0.90, ruido: 0.35, pulso: 0.90 },
};

/** De un color y un animo sale la paleta entera. */
export function derivarPiel(color, animo) {
  if (!HEX.test(String(color || '').trim())) return null;
  const a = ANIMOS[animo] || ANIMOS.oscuro;
  const { h, s, l } = aHsl(color);
  const sat = Math.max(0.35, Math.min(1, s * a.sat));
  // El acento va al otro lado de la rueda: es lo que evita que una paleta de
  // un solo tono se sienta plana.
  const hA = (h + 152) % 360;
  return {
    'senal':       aHex(h, sat, Math.max(0.32, Math.min(0.56, l))),
    'senal-suave': aHex(h, sat * 0.62, 0.72),
    'acento':      aHex(hA, sat * 0.70, a.fondoClaro ? 0.55 : 0.68),
    'tinta':       a.fondoClaro ? aHex(h, 0.55, 0.13) : aHex(h, 0.20, 0.92),
    'papel':       a.fondoClaro ? aHex(h, 0.22, 0.97) : aHex(h, 0.16, 0.09),
    'papel-alto':  a.fondoClaro ? aHex(h, 0.24, 0.93) : aHex(h, 0.18, 0.14),
    'tenue':       aHex(h, 0.22, a.fondoClaro ? 0.68 : 0.52),
    'fondo-hondo': a.fondoClaro ? aHex(h, 0.45, 0.06) : aHex(h, 0.35, 0.04),
    'pulso':       String(a.pulso),
    'ruido':       String(a.ruido),
  };
}
/* Se expone en window para que el agente del sitio y la consola puedan
   llamarlo sin importar módulos. */
window.nervPiel = { ponerPiel, quitarPiel, depurar, derivarPiel, PIELES };
