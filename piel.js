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
  /* El giro de tono de los MEDIOS horneados. El heroe y las laminas de las
     tarjetas no son fotos: las genera el motor del sitio al cargar, en azul,
     y quedan como blobs que no saben nada de fichas. Regenerarlas vive dentro
     del componente (que una sincronizacion repinta), asi que desde fuera se
     les gira el tono con CSS para que sigan al color pedido. */
  'giro':        'grados',
  'medios-sat':  'numero',
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
    } else if (tipo === 'grados') {
      const n = parseFloat(valor);
      if (!isNaN(n)) limpio[nombre] = String(Math.max(-360, Math.min(360, n)));
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
  /* Muchos micro-textos del sitio usan la tinta CON alpha:
     rgba(var(--tinta-rgb), .5). El triplete se publica junto con la ficha
     para que esas medias tintas tambien volteen en modo oscuro. */
  if (fichas['tinta']) {
    const nT = parseInt(fichas['tinta'].slice(1), 16);
    raiz.style.setProperty('--tinta-rgb',
      ((nT >> 16) & 255) + ', ' + ((nT >> 8) & 255) + ', ' + (nT & 255));
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
  raiz.style.removeProperty('--tinta-rgb');
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
  /* 239.7 es el tono del azul original: los medios estan horneados en el.
     El giro es la distancia mas corta hasta el tono pedido; en una paleta
     neutra no hay tono que girar y los medios se desaturan en su lugar. */
  let giro = neutro ? 0 : (h - 239.7);
  if (giro > 180) giro -= 360;
  if (giro < -180) giro += 360;
  piel['giro'] = String(Math.round(giro));
  piel['medios-sat'] = neutro ? '0.15' : '1';
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
export function fijar(nuevo, persistir) {
  estado = Object.assign({}, estado, nuevo || {});
  if (!estado.color && estado.modo === 'claro') quitarPiel();
  else ponerPiel(derivarPiel(estado.color || MOLDE_CLARO['senal'],
                             estado.animo || 'claro', estado.modo));
  document.documentElement.dataset.piel = estado.modo;
  if (boton) {
    const t = boton.querySelector('.nd-t');
    if (t) t.textContent = estado.modo === 'oscuro' ? 'claro' : 'oscuro';
  }
  // La vista previa aplica sin guardar: si la persona navega a otra pagina a
  // media cuenta regresiva, no debe llevarse un estado que iba a expirar.
  if (persistir !== false) guardar();
  return estado;
}

export function estadoActual() { return Object.assign({}, estado); }

/* ---- vista previa efimera ---------------------------------------------

   El gesto de demo: el sitio entero se transforma, corre una cuenta
   regresiva con la opcion de conservarlo, y si nadie decide, vuelve solo.
   Ensenar sin comprometer — nadie se queda atorado en un look que solo
   queria ver, y conservar es UNA decision consciente, no la inercia. */

let previaAntes = null;
let previaTimers = [];

function matarPrevia() {
  previaTimers.forEach(clearInterval);
  previaTimers.forEach(clearTimeout);
  previaTimers = [];
  const o = document.getElementById('nerv-previa');
  if (o) o.remove();
}

export function previa(nuevo, segundos) {
  const total = Math.max(3, Math.min(60, parseFloat(segundos) || 10));
  // Si encadenan vistas previas, el punto de retorno sigue siendo el
  // estado REAL, no la previa anterior.
  if (previaAntes === null) previaAntes = estadoActual();
  matarPrevia();
  if (previaAntes === null) previaAntes = estadoActual();
  fijar(nuevo, false);

  const o = document.createElement('div');
  o.id = 'nerv-previa';
  o.style.cssText = [
    'position:fixed', 'top:14px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:10000', 'display:flex', 'gap:14px', 'align-items:center',
    'font:700 11px/1 ui-monospace,"Courier New",monospace',
    'letter-spacing:2px', 'text-transform:uppercase', 'padding:10px 14px',
    'color:var(--papel-alto,#e6effb)', 'background:var(--fondo-hondo,#03060e)',
    'border:1px solid var(--senal,#0102ec)',
  ].join(';');

  const rotulo = document.createElement('span');
  const cuenta = document.createElement('b');
  cuenta.style.color = 'var(--senal-suave,#7f9bff)';
  const es = (document.documentElement.lang || 'en').startsWith('es');
  rotulo.textContent = es ? '[ vista previa ]' : '[ preview ]';

  function botonsito(texto, accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.style.cssText = 'font:inherit;letter-spacing:inherit;cursor:pointer;' +
      'background:none;border:1px solid currentColor;color:inherit;' +
      'padding:6px 9px;min-height:30px';
    b.addEventListener('click', accion);
    return b;
  }

  const conservar = botonsito(es ? 'conservar' : 'keep', () => {
    matarPrevia();
    previaAntes = null;
    guardar();                       // AHORA si es una decision: se guarda
  });
  const volver = botonsito(es ? 'volver' : 'revert', () => terminar());

  o.appendChild(rotulo); o.appendChild(cuenta);
  o.appendChild(conservar); o.appendChild(volver);
  document.body.appendChild(o);

  let restante = total;
  cuenta.textContent = restante + 's';
  function terminar() {
    const regreso = previaAntes;
    previaAntes = null;
    matarPrevia();
    if (regreso) fijar(regreso);
  }
  previaTimers.push(setInterval(() => {
    restante -= 1;
    if (restante > 0) cuenta.textContent = restante + 's';
  }, 1000));
  previaTimers.push(setTimeout(terminar, total * 1000));
  return total;
}
/* El interruptor. Existe porque hacer que alguien tenga que CONVERSAR con un
   agente para no lastimarse los ojos de noche es mal diseno. Un clic basta.

   En movil se ancla abajo a la izquierda, y el interruptor de idioma de
   index.html se coloca a su derecha por CSS —no metiendose en este
   contenedor—. Se intento lo segundo y salio caro: la topbar donde vive el
   interruptor esta DENTRO de #dc-root, el arbol que pinta React, y sacar un
   nodo de ahi con appendChild tumba el render del componente con un
   `removeChild: node is not a child of this node`. Cada quien en su sitio, y
   el ojo los ve juntos.

   Colapsado es un cuadro de 44px con su icono. Al pasar el raton o al enfocar
   se despliega y ensena la palabra. En tactil no hay hover, asi que el toque
   ACTUA directo y la palabra aparece sola un momento como acuse: pedir dos
   toques para cambiar de modo seria peor que la caja grande que habia. */
let boton = null;
let dock = null;

const ANIM = 260;   /* ms. Corto y sin rebote: esto es un instrumento. */

function sinMovimiento() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

/** El dock. Lo crea quien llegue primero; el de idioma lo reutiliza. */
export function montarDock() {
  if (dock || !document.body) return dock;
  dock = document.getElementById('nerv-dock');
  if (dock) return dock;
  dock = document.createElement('div');
  dock.id = 'nerv-dock';
  dock.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:106px', 'z-index:62',
    'display:flex', 'gap:6px', 'align-items:flex-start',
  ].join(';');
  document.body.appendChild(dock);
  return dock;
}

/* Los estilos del dock van en una hoja, no en `style=`, porque hacen falta
   pseudo-clases (:hover, :focus-visible) y una consulta de medios. Se inyecta
   una sola vez y lleva id para no duplicarse entre paginas. */
function inyectarEstilos() {
  if (document.getElementById('nerv-dock-css')) return;
  const e = document.createElement('style');
  e.id = 'nerv-dock-css';
  e.textContent = `
#nerv-dock .nd-b{
  display:flex; align-items:center;
  height:44px; min-width:44px; max-width:44px; padding:0; border:1px solid var(--tinta,#08123a);
  background:var(--papel,#f4f7fc); color:var(--tinta,#08123a);
  font:700 10px/1 ui-monospace,"Courier New",monospace;
  letter-spacing:2px; text-transform:uppercase; cursor:pointer;
  border-radius:0; overflow:hidden; box-sizing:border-box;
  /* Se anima max-width y no grid-template-columns: la caja se mide por su
     contenido, asi que 0fr -> 1fr no la ensancha. */
  transition:max-width ${ANIM}ms cubic-bezier(.2,.7,.2,1),
             background ${ANIM}ms linear, color ${ANIM}ms linear;
}
#nerv-dock .nd-b:hover,#nerv-dock .nd-b:focus-visible,#nerv-dock .nd-b[data-abierto]{
  max-width:160px;
}
#nerv-dock .nd-b:hover,#nerv-dock .nd-b[data-abierto]{
  background:var(--tinta,#08123a); color:var(--papel,#f4f7fc);
}
#nerv-dock .nd-b:focus-visible{outline:2px solid var(--senal,#0102ec);outline-offset:2px}
#nerv-dock .nd-i{display:grid;place-content:center;flex:0 0 42px;height:42px}
/* El rotulo: min-width 0 es lo que deja que la columna 0fr lo colapse de
   verdad. Sin eso el texto planta su ancho y el boton nunca se cierra. */
#nerv-dock .nd-t{flex:0 0 auto;overflow:hidden;white-space:nowrap;
  padding-right:0;opacity:0;transition:opacity ${ANIM}ms linear,padding ${ANIM}ms linear}
#nerv-dock .nd-b:hover .nd-t,#nerv-dock .nd-b:focus-visible .nd-t,
#nerv-dock .nd-b[data-abierto] .nd-t{opacity:1;padding-right:13px}
#nerv-dock .nd-cuadro{width:16px;height:16px;border:2px solid currentColor;position:relative}
/* Medio cuadro relleno: el sol y la luna de toda la vida, pero con canto. */
#nerv-dock .nd-cuadro::after{content:"";position:absolute;inset:0;
  background:currentColor;clip-path:polygon(0 0,100% 100%,0 100%)}
@media (prefers-reduced-motion: reduce){
  #nerv-dock .nd-b,#nerv-dock .nd-t{transition:none}
}
/* El barrido del cambio de modo: una masa que cruza la pantalla. Nada de
   fundidos suaves — es un filo que pasa. */
#nerv-barrido{position:fixed;inset:0;z-index:9998;pointer-events:none;
  background:var(--tinta,#08123a);transform:translateX(-101%)}
#nerv-barrido.va{animation:nerv-cruza ${ANIM * 2.2}ms cubic-bezier(.65,0,.35,1) forwards}
@keyframes nerv-cruza{
  0%{transform:translateX(-101%)}
  48%{transform:translateX(0)}
  52%{transform:translateX(0)}
  100%{transform:translateX(101%)}
}`;
  document.head.appendChild(e);
}

/** El barrido. Cambia el modo EN MEDIO del cruce, con la pantalla tapada.
 *
 *  Regla de la casa: nada se queda esperando una animacion. El cambio se
 *  aplica con un temporizador, no con `animationend` — si la pestana esta de
 *  fondo o el navegador no dispara el evento, el modo cambia igual y lo unico
 *  que se pierde es el efecto. */
function conBarrido(aplicar) {
  if (sinMovimiento() || !document.body) { aplicar(); return; }
  let velo = document.getElementById('nerv-barrido');
  if (!velo) {
    velo = document.createElement('div');
    velo.id = 'nerv-barrido';
    velo.setAttribute('aria-hidden', 'true');
    document.body.appendChild(velo);
  }
  velo.classList.remove('va');
  void velo.offsetWidth;                 /* reinicia la animacion */
  velo.classList.add('va');
  setTimeout(aplicar, ANIM * 2.2 * 0.5);
  setTimeout(() => velo.classList.remove('va'), ANIM * 2.2 + 60);
}

function etiquetaModo() {
  return estado.modo === 'oscuro' ? 'claro' : 'oscuro';
}

function montarBoton() {
  if (boton || !document.body) return;
  inyectarEstilos();
  const d = montarDock();

  boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'nd-b';
  boton.id = 'nerv-modo';
  boton.setAttribute('aria-label', 'Cambiar entre modo claro y oscuro');

  const icono = document.createElement('span');
  icono.className = 'nd-i';
  icono.setAttribute('aria-hidden', 'true');
  const cuadro = document.createElement('span');
  cuadro.className = 'nd-cuadro';
  icono.appendChild(cuadro);

  const texto = document.createElement('span');
  texto.className = 'nd-t';
  texto.textContent = etiquetaModo();

  boton.appendChild(icono);
  boton.appendChild(texto);

  boton.addEventListener('click', () => {
    conBarrido(() => fijar({ modo: estado.modo === 'oscuro' ? 'claro' : 'oscuro' }));
    /* Acuse en tactil, donde no hay hover: se abre solo y se cierra. */
    boton.dataset.abierto = '1';
    setTimeout(() => { delete boton.dataset.abierto; }, 1100);
  });

  d.appendChild(boton);
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
                    fijar, estadoActual, previa, PIELES };
