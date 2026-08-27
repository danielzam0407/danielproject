/* Quién está mirando su propuesta.

   El generador publica un sitio por prospecto en `nervcenter.online/p/<apodo>/`
   y luego se le manda por correo. Hasta aquí, lo que pasaba después era ciego:
   se sabía a quién se le escribió y nada más.

   Y lo que pasa después es lo único que importa. **Alguien leyendo su propia
   propuesta ahora mismo es el lead más caliente que existe** — está pensando
   en el asunto, con la pieza enfrente, sin que nadie lo empuje. Ése es el
   momento de marcarle, y duraba cero segundos porque nadie se enteraba.

   Es el mismo agujero que `avisos.entregado = 0` del lado del chat: algo que
   pasó y a Daniel no le llegó. Por eso la PRIMERA apertura levanta aviso por
   Telegram y las demás sólo cuentan — un aviso por cada recarga sería ruido y
   dejaría de leerlos, que es como se pierde un canal de aviso.

   ── Lo que se guarda, y lo que NO ──────────────────────────────────────────

   Se guarda el apodo del sitio, cuándo fue la primera vez y cuántas veces. Ya
   está: sin cookies, sin terceros, sin IP, sin huella del navegador. No hay
   nada aquí que Daniel no supiera ya por haberle mandado el correo — lo único
   nuevo es CUÁNDO. Medir más sería tentador y no cambiaría ninguna decisión
   suya, que es la prueba que este tablero le exige a cada cifra. */

const MAX_APODO = 48;

// El apodo lo escribe el generador con [a-z0-9-]. Cualquier otra cosa viene de
// alguien probando, no de una propuesta nuestra.
const APODO = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

/* La tabla se crea sola la primera vez.

   Va así a propósito: una migración a mano es un paso manual más, y el patrón
   que estamos matando es justo ése. `IF NOT EXISTS` es barato y deja que el
   worker se despliegue sin que nadie corra nada después. */
const ESQUEMA = [
  'CREATE TABLE IF NOT EXISTS vistas (' +
    'apodo TEXT PRIMARY KEY, primera TEXT NOT NULL, ultima TEXT NOT NULL, ' +
    'veces INTEGER NOT NULL DEFAULT 1)',
  'CREATE INDEX IF NOT EXISTS vistas_por_ultima ON vistas (ultima DESC)',
];

async function asegurarTabla(db) {
  await db.batch(ESQUEMA.map((s) => db.prepare(s)));
}

/* Cuenta una apertura. Devuelve true si es la PRIMERA de esa propuesta, que es
   la única que merece despertarte el teléfono. */
export async function registrar(db, apodo) {
  const t = new Date().toISOString();
  const upsert = () =>
    db
      .prepare(
        'INSERT INTO vistas (apodo, primera, ultima, veces) VALUES (?, ?, ?, 1) ' +
        'ON CONFLICT(apodo) DO UPDATE SET ultima = excluded.ultima, veces = veces + 1'
      )
      .bind(apodo, t, t)
      .run();

  let r;
  try {
    r = await upsert();
  } catch (e) {
    // Primera vez en la vida: la tabla todavía no existe. Se crea y se
    // reintenta UNA vez — si vuelve a fallar, que reviente hacia arriba.
    await asegurarTabla(db);
    r = await upsert();
  }

  // `changes` es 1 tanto al insertar como al actualizar, así que no distingue.
  // La cuenta sí: veces = 1 sólo puede ser la primera.
  const fila = await db
    .prepare('SELECT veces FROM vistas WHERE apodo = ?')
    .bind(apodo)
    .first();
  return !!fila && fila.veces === 1;
}

/* La baliza. Público a propósito —lo llama la propia página de la propuesta—
   pero detrás del control de origen, así que sólo cuenta si viene de un
   navegador que está en nervcenter.online.

   Contesta 204 SIEMPRE, cuadre o no. Es una baliza: lo que le pase no es
   asunto de quien la dispara, y un error visible sólo le diría a quien esté
   probando qué tan cerca estuvo. */
export async function baliza(peticion, env, contexto, cabeceras, porTelegram) {
  const responder = () => new Response(null, { status: 204, headers: cabeceras });
  if (!env.DB) return responder();

  let apodo = '';
  try {
    const cuerpo = await peticion.json();
    apodo = String(cuerpo.p || '').slice(0, MAX_APODO).toLowerCase();
  } catch {
    return responder();
  }
  if (!APODO.test(apodo)) return responder();

  /* Un tope por apodo y por día. Sin esto, quien vea la baliza en el código de
     la página puede inflar la cuenta y volver inútil la cifra — que no es un
     daño grave, pero sí convierte el tablero en algo que no se puede creer, y
     un tablero en el que no se cree es peor que no tenerlo. */
  const trabajo = (async () => {
    try {
      if (env.CUOTA) {
        const clave = `vista:${apodo}:${new Date().toISOString().slice(0, 10)}`;
        const usado = Number(await env.CUOTA.get(clave)) || 0;
        if (usado >= 40) return;
        await env.CUOTA.put(clave, String(usado + 1), { expirationTtl: 172800 });
      }

      const primera = await registrar(env.DB, apodo);
      if (primera && porTelegram) {
        /* Se avisa DESPUES de contar, no antes.

           En el chat el orden es al reves —primero escribir el aviso en D1,
           luego entregarlo— porque alla el aviso ES el registro del lead. Aqui
           el registro es la fila de `vistas`, que ya quedo: si Telegram falla,
           la apertura sigue en el tablero y no se perdio nada. Por eso no pasa
           por `levantarAviso`, que ademas exige una sesion y esto no la tiene. */
        await porTelegram(
          env,
          {
            titulo: 'están viendo una propuesta',
            cuerpo:
              'Abrieron por primera vez https://nervcenter.online/p/' + apodo + '/\n\n' +
              'Es el momento más caliente que va a tener este prospecto: ' +
              'tiene la pieza enfrente ahora mismo.',
          },
          []
        );
      }
    } catch (e) {
      console.error('no se pudo contar la vista:', e);
    }
  })();

  contexto.waitUntil(trabajo);
  return responder();
}

/* Lo que lee el tablero. Las últimas propuestas abiertas, la más reciente
   arriba: así se lee "a quién le hablo hoy" de un vistazo. */
export async function paraTablero(db, limite = 12) {
  try {
    const { results } = await db
      .prepare(
        'SELECT apodo, primera, ultima, veces FROM vistas ORDER BY ultima DESC LIMIT ?'
      )
      .bind(limite)
      .all();
    const tot = await db
      .prepare('SELECT COUNT(*) AS abiertas, SUM(veces) AS lecturas FROM vistas')
      .first();
    return {
      abiertas: tot ? tot.abiertas || 0 : 0,
      lecturas: tot ? tot.lecturas || 0 : 0,
      recientes: results || [],
    };
  } catch (e) {
    // Todavía nadie ha abierto ninguna: la tabla no existe. No es un error.
    return { abiertas: 0, lecturas: 0, recientes: [] };
  }
}
