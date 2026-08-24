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
for (const ficha of FICHAS) {
  for (const origen of ficha.origenes) {
    if (POR_ORIGEN.has(origen)) {
      // Dos clientes con el mismo origen es un error de configuración que se
      // vería como fugas de datos entre empresas. Mejor que reviente aquí.
      throw new Error(`El origen ${origen} está en dos fichas de cliente.`);
    }
    POR_ORIGEN.set(origen, ficha);
  }
}

/* Devuelve la ficha del cliente dueño de ese origen, o null. Null significa
   403: no es un cliente nuestro. */
export function porOrigen(origen) {
  if (!origen) return null;
  return POR_ORIGEN.get(origen) || null;
}

/* Para el verificador, que revisa a todos. */
export function todas() {
  return FICHAS;
}
