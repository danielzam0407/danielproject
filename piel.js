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

/* El MOLDE: la paleta original, tal cual la diseno Daniel a mano.

   Esto se aprendio en dos pasos, ambos midiendo:

   1. La primera version INVERTIA tinta y papel en los animos oscuros. Salieron
      69 elementos ilegibles contra 17 del original. La razon: el sitio no es
      una superficie plana, es claro arriba con una seccion oscura de contacto,
      y ahi `papel-alto` no es fondo sino el COLOR DEL TEXTO. Varias fichas
      tienen dos papeles segun la region; invertir rompe uno de los dos siempre.

   2. Conservar la luminosidad HSL bajo eso a 17 en morado... pero verde y
      naranja seguian en 32. Porque **la L de HSL no es luminancia percibida**:
      un verde con L=0.46 brilla mucho mas que un azul con la misma L, y pierde
      contraste contra el papel.

   Por eso lo que se conserva ahora es la LUMINANCIA RELATIVA de cada ficha
   —la misma magnitud con la que se calcula el contraste WCAG—. Asi toda
   relacion que Daniel diseno a mano se preserva por construccion, sea cual
   sea el tono que pidan. */
/* Se auditaron los usos reales y salio algo tranquilizador: de las fichas que
   parecian tener dos papeles, TODAS las excepciones eran puntos de 7px —
   cursores parpadeantes y marcas decorativas—. Eso no es superficie, es tinta.

   Asi que los papeles estan limpios:

     SUPERFICIES  papel (region clara)  ·  fondo-hondo (seccion de contacto)
     TINTA        tinta (sobre papel)   ·  papel-alto (sobre fondo-hondo)
                  senal · senal-suave · tenue · acento

   Por eso el modo oscuro SI se puede: voltear `papel` y `tinta`, y aclarar
   `senal` para que siga leyendose. Todo lo demas ya vivia sobre oscuro, porque
   la seccion de contacto siempre fue oscura.

   Lo que NO se puede es derivar el modo oscuro invirtiendo luminancias a lo
   bruto: se probo, dio 69 elementos ilegibles. Por eso son DOS moldes escritos
   a mano, y el motor solo les cambia el tono. */
const MOLDE_CLARO = {
  'senal':       '#0102ec',
  'senal-suave': '#7f9bff',
  'acento':      '#9ef0e4',
  'tinta':       '#08123a',
  'papel':       '#f4f7fc',
  'papel-alto':  '#e6effb',
  'tenue':       '#9db8dc',
  'fondo-hondo': '#03060e',
};

/* El molde oscuro. `senal` sube de luminancia porque ahora vive sobre una
   superficie oscura; `tinta` y `papel` se intercambian de papel. El resto
   apenas se mueve: ya estaba pensado para leerse sobre negro. */
const MOLDE_OSCURO = {
  'senal':       '#6f8cff',
  'senal-suave': '#a8bcff',
  'acento':      '#9ef0e4',
  'tinta':       '#e6effb',
  'papel':       '#0b1020',
  'papel-alto':  '#eef3fd',
  'tenue':       '#8fa3c4',
  'fondo-hondo': '#05070f',
};
/** Luminancia relativa (WCAG). Es la magnitud que decide el contraste. */
function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/* La luminancia objetivo y la saturacion de cada ficha, sacadas de un molde. */
function perfilDe(molde) {
  return Object.fromEntries(Object.entries(molde).map(([k, hex]) => {
    const { s } = aHsl(hex);
    return [k, { luz: luminancia(hex), s }];
  }));
}
const PERFILES = {
  claro:  perfilDe(MOLDE_CLARO),
  oscuro: perfilDe(MOLDE_OSCURO),
};
/** Busca la L que da la luminancia pedida, para ESE tono y saturacion.
    Busqueda binaria: 18 pasos bastan para clavarla. */
function conLuminancia(h, s, objetivo) {
  let lo = 0, hi = 1, hex = aHex(h, s, 0.5);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    hex = aHex(h, s, mid);
    if (luminancia(hex) < objetivo) lo = mid; else hi = mid;
  }
  return hex;
}

/* Los animos ya NO invierten nada. Solo ajustan caracter. */
const ANIMOS = {
  claro:  { sat: 0.85, ruido: 0.05, pulso: 1.00 },
  oscuro: { sat: 1.05, ruido: 0.35, pulso: 0.90 },
  duro:   { sat: 1.30, ruido: 0.85, pulso: 1.40 },
  limpio: { sat: 0.55, ruido: 0.00, pulso: 0.75 },
  calido: { sat: 0.90, ruido: 0.35, pulso: 0.90 },
};

/** De un color y un animo sale la paleta entera, con el molde intacto. */
/** De un color, un animo y un modo sale la paleta entera.

    modo  'claro' | 'oscuro'  — la ESTRUCTURA: que superficie es fondo.
    animo  el CARACTER: cuanta saturacion, cuanto grano, que tan rapido.

    Son cosas distintas a proposito. Antes 'oscuro' era solo un animo y no
    oscurecia nada, que es justo lo que confundia: pedir negro daba una paleta
    monocromatica sobre fondo blanco. */
export function derivarPiel(color, animo, modo) {
  const pedido = String(color || '').trim().toLowerCase();
  if (!HEX.test(pedido)) return null;
  const a = ANIMOS[animo] || ANIMOS.oscuro;
  const perfil = PERFILES[modo === 'oscuro' ? 'oscuro' : 'claro'];
  const { h, s: sPedida } = aHsl(pedido);

  /* Un color sin tono NO tiene tono. `aHsl` devuelve h=0 para negro, blanco y
     gris —porque no hay angulo que devolver— y usar ese 0 los pintaba a los
     tres de ROJO. Ahora, si el pedido es neutro, la paleta sale monocromatica
     de verdad, que es lo que alguien espera al decir "negro". */
  const neutro = sPedida < 0.12;

  /* La saturacion del pedido tambien se respeta: el molde manda la proporcion
     entre fichas, el pedido manda cuanta hay. Sin esto, un morado palido y uno
     intenso daban el mismo resultado. */
  const fuerza = neutro ? 0 : 0.40 + Math.min(1, sPedida) * 0.60;
  const hAcento = neutro ? h : (h + 152) % 360;

  const piel = {};
  for (const [ficha, base] of Object.entries(perfil)) {
    const tono = ficha === 'acento' ? hAcento : h;
    piel[ficha] = conLuminancia(tono, Math.min(1, base.s * a.sat * fuerza), base.luz);
  }
  piel['pulso'] = String(a.pulso);
  piel['ruido'] = String(a.ruido);
  return piel;
}

/** El modo sin cambiar de color: mantiene el tono actual y solo voltea la
    estructura. Es lo que usa el interruptor visible. */
export function ponerModo(modo, color, animo) {
  const base = HEX.test(String(color || '')) ? color : MOLDE_CLARO['senal'];
  return ponerPiel(derivarPiel(base, animo || 'claro', modo));
}

/* ---- memoria de sesion e interruptor -----------------------------------

   La eleccion sigue al visitante entre paginas: si pide oscuro en la portada
   y entra a /about, sigue oscuro. Vive en sessionStorage —no localStorage— a
   proposito: se borra al cerrar la pestana, asi que el sitio siempre se ve
   como Daniel lo diseno la PRIMERA vez que alguien llega. La primera
   impresion es el instrumento de venta; el cambio es un momento, no un
   ajuste permanente.

   Y por eso tampoco se respeta `prefers-color-scheme`: si alguien con el
   telefono en oscuro llegara a un sitio ya oscuro, pedirle al agente que lo
   oscurezca no haria nada, y la demostracion se cae justo cuando debia
   impresionar. */

const LLAVE = 'nerv:piel';
let estado = { modo: 'claro', color: null, animo: null };

function guardar() {
  try { sessionStorage.setItem(LLAVE, JSON.stringify(estado)); } catch (e) {}
}

/** Aplica un estado completo y lo recuerda. Es la unica puerta de entrada. */
export function fijar(nuevo) {
  estado = Object.assign({}, estado, nuevo || {});
  if (!estado.color && estado.modo === 'claro') quitarPiel();
  else ponerPiel(derivarPiel(estado.color || MOLDE_CLARO['senal'],
                             estado.animo || 'claro', estado.modo));
  document.documentElement.dataset.piel = estado.modo;
  if (boton) boton.textContent = estado.modo === 'oscuro' ? 'claro' : 'oscuro';
  guardar();
  return estado;
}

export function estadoActual() { return Object.assign({}, estado); }

/* El interruptor. Existe porque hacer que alguien tenga que CONVERSAR con un
   agente para no lastimarse los ojos de noche es mal diseno. Un clic basta. */
let boton = null;

function montarBoton() {
  if (boton || !document.body) return;
  boton = document.createElement('button');
  boton.type = 'button';
  boton.id = 'nerv-modo';
  boton.setAttribute('aria-label', 'Cambiar entre modo claro y oscuro');
  boton.textContent = estado.modo === 'oscuro' ? 'claro' : 'oscuro';
  boton.style.cssText = [
    'position:fixed', 'left:14px', 'bottom:14px', 'z-index:9999',
    'font:700 10px/1 ui-monospace,"Courier New",monospace',
    'letter-spacing:2px', 'text-transform:uppercase',
    'padding:9px 11px', 'min-height:34px', 'cursor:pointer',
    'color:var(--papel-alto,#e6effb)', 'background:var(--fondo-hondo,#03060e)',
    'border:1px solid var(--senal,#0102ec)', 'opacity:.72',
    'transition:opacity .2s ease',
  ].join(';');
  boton.addEventListener('mouseenter', () => { boton.style.opacity = '1'; });
  boton.addEventListener('mouseleave', () => { boton.style.opacity = '.72'; });
  boton.addEventListener('click', () => {
    fijar({ modo: estado.modo === 'oscuro' ? 'claro' : 'oscuro' });
  });
  document.body.appendChild(boton);
}

/* Se restaura ANTES de montar el boton para que ya nazca con la etiqueta
   correcta, y se aplica sin esperar animacion: regla de la casa, nada queda
   invisible esperando un frame. */
function arrancar() {
  try {
    const g = JSON.parse(sessionStorage.getItem(LLAVE) || 'null');
    if (g && typeof g === 'object') estado = Object.assign(estado, g);
  } catch (e) {}
  if (estado.modo === 'oscuro' || estado.color) fijar({});
  montarBoton();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancar);
} else {
  arrancar();
}
/* Se expone en window para que el agente del sitio y la consola puedan
   llamarlo sin importar módulos. */
window.nervPiel = { ponerPiel, quitarPiel, depurar, derivarPiel, ponerModo,
                    fijar, estadoActual, PIELES };
