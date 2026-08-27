/* El registro de clientes.

   Dar de alta una empresa son dos líneas: importar su ficha y meterla en la
   lista. Todo lo demás —topes, persona, herramientas, secretos— vive en su
   propio archivo y no toca a nadie más.

   El origen es la llave. Quien llama desde https://acme.mx es Acme, y sólo
   puede ver, gastar y escribir lo de Acme. No hay un parámetro `cliente` en el
   cuerpo de la petición a propósito: sería una cadena que manda el navegador, y
   entonces cualquiera podría gastarse la cuota de otro. */

import daniel from './daniel.js';

const FICHAS = [daniel];

/* origen -> ficha. Se arma una vez al arrancar el worker, no por petición. */
const POR_ORIGEN = new Map();
const POR_ORIGEN_DEV = new Map();
for (const ficha of FICHAS) {
  for (const origen of ficha.origenes) {
    if (POR_ORIGEN.has(origen)) {
      // Dos clientes con el mismo origen es un error de configuración que se
      // vería como fugas de datos entre empresas. Mejor que reviente aquí.
      throw new Error(`El origen ${origen} está en dos fichas de cliente.`);
    }
    POR_ORIGEN.set(origen, ficha);
  }
  for (const origen of ficha.origenesDev || []) {
    POR_ORIGEN_DEV.set(origen, ficha);
  }
}

/* Devuelve la ficha del cliente dueño de ese origen, o null. Null significa
   403: no es un cliente nuestro.

   `origenesDev` sólo cuenta si `env.MODO_DEV` está puesto, y en el worker
   desplegado NO lo está. Antes los orígenes de desarrollo vivían revueltos con
   los de producción, y `http://localhost:4322` —el servidor estático con el que
   se ve el sitio en la laptop— era un origen válido en el worker público.

   La cabecera Origin la pone el navegador, pero cualquier cliente que no sea un
   navegador la escribe a mano. Medido el 2026-08-25 contra el worker en vivo:
   `curl -H 'Origin: http://localhost:4322' .../chat` devolvía 200 y gastaba
   cuota de DeepSeek. El control de origen —que es LA llave del molde
   multicliente— tenía una puerta que abría cualquiera que leyera el repo.

   Para trabajar en local se levanta el worker en local (`launch.json`, config
   `agente`) y ahí sí hay MODO_DEV. */
export function porOrigen(origen, env) {
  if (!origen) return null;
  const suyo = POR_ORIGEN.get(origen);
  if (suyo) return suyo;
  if (env && env.MODO_DEV) return POR_ORIGEN_DEV.get(origen) || null;
  return null;
}

/* Quién es el dueño de un número de WhatsApp. Mismo papel que `porOrigen`:
   decide de qué cliente es la petición, y sin dueño no se atiende.

   Se resuelve por `ajustes(env)` y no por una lista estática como los orígenes
   porque el id del número es un secreto —vive en `env`, no en el repo— y una
   ficha no debe poder leer los secretos de otra. Son cuatro fichas como mucho;
   recorrerlas cuesta menos que mantener un índice que se puede quedar viejo.

   La firma del webhook prueba una sola cosa: que el mensaje lo mandó Kapso.
   Quién es el dueño lo decide este número. Eso alcanza mientras todos los
   números del proyecto sean nuestros. El día que una empresa traiga SU propio
   proyecto de Kapso traerá también su propio secreto, y entonces hace falta
   otra puerta — una sola no puede verificar dos firmas distintas. */
export function porNumeroWhatsapp(numeroId, env) {
  if (!numeroId) return null;
  for (const ficha of FICHAS) {
    if (!ficha.whatsapp) continue;
    const ajustes = ficha.ajustes(env);
    if (ajustes.kapsoNumeroId && String(ajustes.kapsoNumeroId) === String(numeroId)) return ficha;
  }
  return null;
}

/* Para el vigilante: los orígenes de producción, tal cual, para que pueda
   revisar que ninguno sea de desarrollo. */
export function origenesDeProduccion() {
  return [...POR_ORIGEN.keys()];
}

/* Para el verificador, que revisa a todos. */
export function todas() {
  return FICHAS;
}
