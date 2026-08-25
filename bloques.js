/* Componer la página en vivo: el agente agrega y quita secciones enteras.
   nerv — https://nervcenter.online

   Nivel 3 del plan. El nivel 2 (la piel) cambia cómo se ve lo que ya está;
   este cambia QUÉ hay en la página. La misma regla lo gobierna: el agente
   nunca escribe marcado — elige piezas de un catálogo curado, y cada pieza
   posible es una que ya estaba aprobada. Un agente que puede escribir HTML
   frente a desconocidos es un XSS esperando instrucciones.

   Dónde viven los bloques, y por qué: las secciones del sitio son hijas del
   componente <x-dc>, que se repinta solo — meterle hijos es pelear contra su
   render. Los bloques se montan DESPUÉS del componente, tras la sección de
   contacto, y el diseño lo abraza: son anexos del expediente ([ annex 01 ]),
   que es exactamente el lenguaje del sitio.

   Mismas reglas que la piel:
   - Viven en la sesión de quien los pidió. No se guardan.
   - Un fallo aquí no puede tumbar el chat: quien nos llama nos envuelve.
   - Heredan las fichas (var(--...)), así que siguen a la piel del agente. */

const IDIOMAS = ['es', 'en'];

/* El catálogo. Todo el texto es de la casa — el agente sólo elige el nombre.
   Cada bloque trae sus dos idiomas: el sitio es bilingüe y una sección que se
   queda en inglés cuando todo está en español se lee como remiendo. */
const CATALOGO = {

  proceso: {
    es: {
      titulo: 'cómo se trabaja',
      pasos: [
        ['01 / contar', 'Cuentas qué necesitas — por este chat, por correo o en una llamada. Sin formularios largos: con entender el encargo basta.'],
        ['02 / proponer', 'Recibes una propuesta que se puede navegar, no un PDF con promesas. Si hay 3D o movimiento, lo ves funcionando desde el principio.'],
        ['03 / construir', 'El avance se ve en una liga privada durante toda la construcción. El sitio se entrega con su agente de chat y su forma de contacto ya integrados.'],
      ],
    },
    en: {
      titulo: 'how it works',
      pasos: [
        ['01 / tell', 'Tell us what you need — through this chat, by mail, or on a call. No long forms: understanding the job is enough.'],
        ['02 / propose', 'You get a proposal you can navigate, not a PDF full of promises. If there is 3D or motion involved, you see it working from day one.'],
        ['03 / build', 'Progress lives at a private link through the whole build. The site ships with its own chat agent and contact flow already integrated.'],
      ],
    },
  },

  preguntas: {
    es: {
      titulo: 'preguntas directas',
      pares: [
        ['¿Cuánto cuesta?', 'No hay lista de precios porque no hay plantillas: cada encargo se cotiza después de entenderlo. Una llamada corta basta para darte un rango honesto.'],
        ['¿Cuánto tarda?', 'Depende del alcance. Una pieza chica se mide en días; un sitio completo con agente, en semanas. El rango real va en la propuesta.'],
        ['¿Qué incluye?', 'Diseño desde cero, construcción, despliegue, y un agente de chat propio que conoce tu negocio y agenda en tu calendario real — como el de este sitio.'],
        ['¿Sólo Monterrey?', 'No. La base está en Monterrey y ahí es fácil verse en persona, pero se trabaja igual a distancia, en español o inglés.'],
      ],
    },
    en: {
      titulo: 'straight answers',
      pares: [
        ['How much is it?', 'There is no price list because there are no templates: every job is quoted after understanding it. A short call is enough for an honest range.'],
        ['How long does it take?', 'Depends on scope. A small piece is measured in days; a full site with an agent, in weeks. The real range goes in the proposal.'],
        ['What is included?', 'Design from scratch, the build, deployment, and a chat agent of your own that knows your business and books into your real calendar — like the one on this site.'],
        ['Monterrey only?', 'No. The base is Monterrey, where meeting in person is easy, but remote works just as well, in Spanish or English.'],
      ],
    },
  },

  demo: {
    es: {
      titulo: 'piezas en vivo',
      nota: 'Nada de esto es un video de muestra: todo corre en tu navegador, ahora.',
      ligas: [
        ['fracture', 'Escribe una palabra y se vuelve una portada. Motor generativo con semilla determinista.', 'https://danielzam0407.github.io/fracture/'],
        ['work2', 'Un portafolio que se camina como menú de videojuego. Pasillo 3D en CSS puro, sin WebGL.', 'https://danielzam0407.github.io/menu-pasillo/'],
        ['recorrido', 'Pieza de laboratorio: un recorrido que avanza con tu scroll, cuadro a cuadro. Material de muestra.', '/lab/recorrido/'],
      ],
    },
    en: {
      titulo: 'live pieces',
      nota: 'None of this is a demo reel: everything runs in your browser, right now.',
      ligas: [
        ['fracture', 'Type a word and it becomes a cover. Generative engine with a deterministic seed.', 'https://danielzam0407.github.io/fracture/'],
        ['work2', 'A portfolio you walk like a game menu. A 3D hallway in pure CSS, no WebGL.', 'https://danielzam0407.github.io/menu-pasillo/'],
        ['walkthrough', 'Lab piece: a walkthrough that moves with your scroll, frame by frame. Sample material.', '/lab/recorrido/'],
      ],
    },
  },
};

const NOMBRES = Object.keys(CATALOGO);

/* ---- estilos, autocontenidos e idempotentes --------------------------- */

const CSS = `
#nerv-bloques { position: relative; z-index: 2;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  background: var(--papel, #f4f7fc); color: var(--tinta, #08123a); }
#nerv-bloques .bloque { max-width: 1080px; margin: 0 auto;
  padding: 56px 24px 64px; border-top: 1px solid rgba(var(--tinta-rgb, 8,18,58), .16);
  animation: nerv-anexo .5s ease both; }
@keyframes nerv-anexo { from { transform: translateY(14px); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { #nerv-bloques .bloque { animation: none; } }
#nerv-bloques .anexo { font-size: 11px; letter-spacing: 3px;
  text-transform: uppercase; color: var(--senal, #0102ec); margin: 0 0 10px; }
#nerv-bloques h2 { font-family: 'Space Grotesk', sans-serif; margin: 0 0 26px;
  font-size: clamp(26px, 4.4vw, 40px); font-weight: 700; letter-spacing: -1px; }
#nerv-bloques .rejilla { display: grid; gap: 22px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
#nerv-bloques .celda { border: 1px solid rgba(var(--tinta-rgb, 8,18,58), .18);
  padding: 18px 16px; }
#nerv-bloques .celda b { display: block; font-size: 12px; letter-spacing: 2px;
  text-transform: uppercase; color: var(--senal, #0102ec); margin: 0 0 9px; }
#nerv-bloques .celda p { margin: 0; font-size: 13.5px; line-height: 1.66; }
#nerv-bloques .nota { font-size: 12px; opacity: .65; margin: 0 0 18px; }
#nerv-bloques a.celda { display: block; text-decoration: none;
  color: var(--tinta, #08123a); transition: border-color .2s ease; }
#nerv-bloques a.celda:hover { border-color: var(--senal, #0102ec); }
#nerv-bloques a.celda span { font-size: 11px; letter-spacing: 1px;
  color: var(--senal, #0102ec); }
`;

function asegurarEstilos() {
  if (!document.getElementById('nerv-bloques-css')) {
    const st = document.createElement('style');
    st.id = 'nerv-bloques-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
}

/* ---- construcción (createElement, nunca innerHTML con datos ajenos) --- */

function celda(titulo, cuerpo, href) {
  const el = document.createElement(href ? 'a' : 'div');
  el.className = 'celda';
  if (href) { el.href = href; if (href.startsWith('http')) { el.target = '_blank'; el.rel = 'noopener'; } }
  const b = document.createElement('b'); b.textContent = titulo; el.appendChild(b);
  const p = document.createElement('p'); p.textContent = cuerpo; el.appendChild(p);
  if (href) { const s = document.createElement('span'); s.textContent = '-> abrir'; el.appendChild(s); }
  return el;
}

function pintarBloque(nombre, idioma) {
  const d = CATALOGO[nombre][idioma];
  const sec = document.createElement('section');
  sec.className = 'bloque';
  sec.dataset.bloque = nombre;

  const anexo = document.createElement('p'); anexo.className = 'anexo'; sec.appendChild(anexo);
  const h = document.createElement('h2'); h.textContent = d.titulo; sec.appendChild(h);
  if (d.nota) { const n = document.createElement('p'); n.className = 'nota'; n.textContent = d.nota; sec.appendChild(n); }

  const rejilla = document.createElement('div'); rejilla.className = 'rejilla';
  (d.pasos || d.pares || []).forEach(([t, c]) => rejilla.appendChild(celda(t, c)));
  (d.ligas || []).forEach(([t, c, u]) => rejilla.appendChild(celda(t, c, u)));
  sec.appendChild(rejilla);
  return sec;
}

/* ---- estado ----------------------------------------------------------- */

function idioma() {
  return (document.documentElement.lang || 'en').startsWith('es') ? 'es' : 'en';
}

function contenedor() {
  let c = document.getElementById('nerv-bloques');
  if (!c) {
    c = document.createElement('div');
    c.id = 'nerv-bloques';
    /* Después del componente RENDERIZADO. La etiqueta <x-dc> es sólo la
       semilla — el árbol vivo está en #dc-root, y montarse tras la etiqueta
       dejaba los anexos encimados a media página, con los tickers absolutos
       del componente atravesándolos. Ese bug ya salió en producción. */
    const raiz = document.getElementById('dc-root');
    if (raiz && raiz.parentNode) {
      raiz.parentNode.insertBefore(c, raiz.nextSibling);
    } else {
      document.body.appendChild(c);
    }
  }
  return c;
}

function renumerar() {
  const c = document.getElementById('nerv-bloques');
  if (!c) return;
  [...c.querySelectorAll('.anexo')].forEach((a, i) => {
    a.textContent = '[ annex ' + String(i + 1).padStart(2, '0') + ' ]';
  });
}

export function agregar(nombre) {
  if (!CATALOGO[nombre]) return false;
  asegurarEstilos();
  const c = contenedor();
  const previo = c.querySelector('[data-bloque="' + nombre + '"]');
  if (previo) {                       // ya estaba: sólo enseñarlo otra vez
    previo.scrollIntoView({ behavior: 'auto', block: 'start' });
    return true;
  }
  const sec = pintarBloque(nombre, idioma());
  c.appendChild(sec);
  renumerar();
  // Enseñar lo que apareció es la mitad del efecto. Sin smooth a propósito:
  // el momento es "apareció aquí", no un paseo por toda la página.
  sec.scrollIntoView({ behavior: 'auto', block: 'start' });
  return true;
}

export function quitar(nombre) {
  const c = document.getElementById('nerv-bloques');
  const el = c && c.querySelector('[data-bloque="' + nombre + '"]');
  if (el) { el.remove(); renumerar(); return true; }
  return false;
}

export function limpiar() {
  const c = document.getElementById('nerv-bloques');
  if (c) c.textContent = '';
}

export function montados() {
  const c = document.getElementById('nerv-bloques');
  return c ? [...c.querySelectorAll('[data-bloque]')].map(e => e.dataset.bloque) : [];
}

/* El interruptor de idioma del sitio cambia el atributo lang del documento.
   Los bloques montados se repintan para seguirlo — una sección que se queda
   en inglés cuando todo pasó a español se lee como remiendo. */
new MutationObserver(() => {
  const c = document.getElementById('nerv-bloques');
  if (!c) return;
  const idm = idioma();
  [...c.querySelectorAll('[data-bloque]')].forEach(viejo => {
    viejo.replaceWith(pintarBloque(viejo.dataset.bloque, idm));
  });
  renumerar();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

window.nervBloques = { agregar, quitar, limpiar, montados, NOMBRES };
