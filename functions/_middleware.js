/* Negociación de contenido para agentes — acceptmarkdown.com

   Un agente que pide `Accept: text/markdown` recibe la versión .md de la
   página; un navegador recibe el HTML de siempre. Nadie nota la diferencia
   salvo quien la pidió.

   El `Vary: Accept` NO es decorativo y es la parte que se olvida: sin él, la
   caché de Cloudflare guarda la primera variante que le pidieron y se la
   sirve a todos. Un agente acaba recibiendo HTML, o peor, un navegador
   recibe markdown crudo — dependiendo de quién llegó primero. */

const EQUIVALENTES = {
  '/': '/index.md',
  '/index.html': '/index.md',
  '/about': '/about.md',
  '/about.html': '/about.md',
  '/contact': '/contact.md',
  '/contact.html': '/contact.md',
  '/privacy': '/privacy.md',
  '/privacy.html': '/privacy.md',
};

/* Lo que es taller, no sitio.

   Cloudflare Pages publica la raíz del repo entera, así que el código del
   worker quedaba servido bajo el dominio: `/agente/src/clientes/daniel.js`
   devolvía 200 con el perfil y las instrucciones completas del agente, y
   `wrangler.toml` con los ids de KV y D1.

   Eso NO los volvía secretos —el repo es público en GitHub y ahí siguen— pero
   este sitio está hecho a propósito para que los agentes lo rastreen (llms.txt,
   sitemap, negociación de markdown). Servirles el taller significa que se lo
   tragan como si fuera una página más del portfolio. Son cosas distintas: una
   es código que alguien puede ir a leer, la otra es código que el sitio ofrece.

   Va aquí y no en `_headers` porque `_headers` sólo pone cabeceras; no puede
   negar una ruta. */
const TALLER = [
  /^\/agente(\/|$)/i,        // el worker completo: prompt, perfil, herramientas
  /^\/functions(\/|$)/i,     // este mismo archivo
  /^\/CLAUDE\.md$/i,         // las reglas de la casa
  /^\/\.claude(\/|$)/i,      // el escuadrón
  /^\/lab(\/|$)/i,           // pruebas a medio hacer, no son obra publicada
  /\.(py|toml|lock)$/i,      // herramientas y candados de dependencias
  /^\/(package|package-lock)\.json$/i,
];

/** ¿El cliente prefiere markdown sobre html? Lee las calidades del Accept. */
function prefiereMarkdown(accept) {
  if (!accept) return false;
  let md = 0, html = 0;
  for (const parte of accept.split(',')) {
    const [tipo, ...params] = parte.trim().split(';');
    const q = params.reduce((v, p) => {
      const m = p.trim().match(/^q=([0-9.]+)$/);
      return m ? parseFloat(m[1]) : v;
    }, 1);
    const t = tipo.trim().toLowerCase();
    if (t === 'text/markdown' || t === 'text/x-markdown') md = Math.max(md, q);
    if (t === 'text/html' || t === 'application/xhtml+xml') html = Math.max(html, q);
    // `*/*` no cuenta como preferencia explícita por markdown: los
    // navegadores lo mandan siempre y servirles .md rompería el sitio.
  }
  return md > 0 && md >= html;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  /* El taller se niega con el 404 de verdad, no con uno pelado: quien llegue
     ahí —persona o rastreador— recibe la misma página que cualquier ruta
     inexistente, con sus enlaces al sitemap y a llms.txt. Un 403 confirmaría
     que el archivo existe; un 404 no dice nada. */
  if (TALLER.some((patron) => patron.test(url.pathname))) {
    const cuatro = await env.ASSETS.fetch(new Request(new URL('/404.html', url)));
    return new Response(cuatro.body, {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex',
        vary: 'Accept, Accept-Encoding',
      },
    });
  }

  const equivalente = EQUIVALENTES[url.pathname];

  if (equivalente && prefiereMarkdown(request.headers.get('accept'))) {
    const md = await env.ASSETS.fetch(new Request(new URL(equivalente, url), request));
    if (md.ok) {
      const cabeceras = new Headers(md.headers);
      cabeceras.set('content-type', 'text/markdown; charset=utf-8');
      cabeceras.set('vary', 'Accept, Accept-Encoding');
      cabeceras.set('x-content-variant', 'markdown');
      return new Response(md.body, { status: 200, headers: cabeceras });
    }
  }

  // Todo lo demás sigue su curso, pero declarando que la respuesta depende
  // del Accept — incluidas las 404, para que la caché no las mezcle.
  const respuesta = await next();
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set('vary', 'Accept, Accept-Encoding');
  return new Response(respuesta.body, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: cabeceras,
  });
}
