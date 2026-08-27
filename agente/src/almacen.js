/* Dónde vive la conversación.

   Antes vivía en un array del navegador y viajaba en cada petición. Eso tenía
   tres problemas a la vez, y los tres se arreglan con este archivo:

     1. Al recargar la página el hilo se perdía.
     2. Al reiniciarse el worker daba igual, pero nadie del lado de acá podía
        leer nunca lo que el agente había dicho.
     3. Y el peor: si el navegador manda el historial, cualquiera puede mandar
        turnos de *agente* inventados y ponerle palabras en la boca. El filtro
        de antes rechazaba bloques crudos, pero aceptaba {rol:'agente'} tal cual.

   Ahora el navegador manda un id de sesión y nada más. El texto que el modelo
   recibe como suyo es el que nosotros escribimos. */

const MAX_LARGO_MENSAJE = 1500;
const MAX_TURNOS = 16;

function ahora() {
  return new Date().toISOString();
}

/* Abre una conversación y devuelve su id. El id lo genera el servidor: 122 bits
   de aleatoriedad, que es lo que impide que alguien adivine la sesión de otro
   y siga su conversación. */
export async function abrir(db, clienteId, ip) {
  const id = crypto.randomUUID();
  const t = ahora();
  await db
    .prepare('INSERT INTO sesiones (id, cliente, creada, vista, ip) VALUES (?, ?, ?, ?, ?)')
    .bind(id, clienteId, t, t, ip)
    .run();
  return id;
}

/* Lo mismo, para un canal de afuera: WhatsApp y lo que venga después.

   `externo` es el id que ese canal le da a la conversación —en Kapso, el de la
   charla— y NUNCA el teléfono: un dato personal no tiene por qué vivir en una
   columna indexada para siempre.

   Lo que hace correcta esta función es el INSERT OR IGNORE contra el índice
   único: si dos mensajes de la misma persona llegan a la vez, los dos intentan
   abrir y sólo uno lo consigue; el que pierde recoge el id del que ganó y los
   dos siguen en el MISMO hilo. Con un puente en KV esto salía mal y se midió:
   dos mensajes de un mismo lote de Kapso abrían dos conversaciones separadas,
   cada una ciega a la otra. */
export async function abrirCanal(db, clienteId, canal, externo) {
  const id = crypto.randomUUID();
  const t = ahora();
  const r = await db
    .prepare(
      'INSERT OR IGNORE INTO sesiones (id, cliente, creada, vista, ip, canal, externo) ' +
        'VALUES (?, ?, ?, ?, NULL, ?, ?)'
    )
    .bind(id, clienteId, t, t, canal, externo)
    .run();
  if (r.meta.changes > 0) return id;

  const fila = await db
    .prepare('SELECT id FROM sesiones WHERE cliente = ? AND canal = ? AND externo = ?')
    .bind(clienteId, canal, externo)
    .first();
  return fila ? fila.id : null;
}

/* El hilo abierto de una conversación de afuera, si todavía está fresco.

   `vidaSegundos` es cuánto dura el puente. Al vencer se suelta —el hilo viejo
   se queda en la bandeja, sólo deja de ser el hilo "actual" de esa charla— y
   el siguiente mensaje abre uno nuevo sin chocar con el índice único. Para
   WhatsApp son 24 h, que es la misma ventana en la que Meta deja contestar sin
   plantilla: el hilo y el permiso de responder caducan juntos, a propósito. */
export async function porCanal(db, clienteId, canal, externo, vidaSegundos) {
  const fila = await db
    .prepare('SELECT id, vista FROM sesiones WHERE cliente = ? AND canal = ? AND externo = ?')
    .bind(clienteId, canal, externo)
    .first();
  if (!fila) return null;

  const edad = Date.now() - Date.parse(fila.vista);
  if (!Number.isFinite(edad) || edad > vidaSegundos * 1000) {
    await db.prepare('UPDATE sesiones SET externo = NULL WHERE id = ?').bind(fila.id).run();
    return null;
  }
  return fila.id;
}

/* Busca una sesión y comprueba que sea de este cliente.

   Esa segunda parte es la que impide que un id filtrado de una empresa sirva
   para escribir en la conversación de otra. Si no cuadra, devolvemos null y el
   worker abre una sesión nueva — sin decir por qué, porque explicar el motivo
   es decirle a quien prueba ids qué tan cerca estuvo. */
export async function buscar(db, id, clienteId) {
  if (typeof id !== 'string' || id.length !== 36) return null;
  const fila = await db
    .prepare('SELECT id, cliente, turnos FROM sesiones WHERE id = ? AND cliente = ?')
    .bind(id, clienteId)
    .first();
  return fila || null;
}

/* El historial en la forma que espera el modelo. Se corta a los últimos turnos
   porque un hilo largo se paga entero en cada vuelta. */
export async function historial(db, sesionId) {
  const { results } = await db
    .prepare(
      'SELECT rol, texto FROM (' +
        'SELECT id, rol, texto FROM mensajes WHERE sesion = ? ORDER BY id DESC LIMIT ?' +
      ') ORDER BY id ASC'
    )
    .bind(sesionId, MAX_TURNOS)
    .all();

  return (results || [])
    .map((m) => ({
      role: m.rol === 'visitante' ? 'user' : 'assistant',
      content: String(m.texto).slice(0, MAX_LARGO_MENSAJE),
    }))
    .filter((m) => m.content.trim().length > 0);
}

/* Guarda un turno y adelanta el reloj de la sesión. Van juntos a propósito: una
   sesión cuya última actividad no se movió se hunde en la bandeja y no la ves. */
export async function guardar(db, sesionId, rol, texto) {
  const limpio = String(texto || '').slice(0, MAX_LARGO_MENSAJE * 4);
  if (!limpio.trim()) return;
  const t = ahora();
  await db.batch([
    db
      .prepare('INSERT INTO mensajes (sesion, rol, texto, cuando) VALUES (?, ?, ?, ?)')
      .bind(sesionId, rol, limpio, t),
    db
      .prepare('UPDATE sesiones SET vista = ?, turnos = turnos + 1 WHERE id = ?')
      .bind(t, sesionId),
  ]);
}

/* Deja constancia de la intención ANTES de intentar avisar por Telegram.

   El orden importa: si primero avisáramos y luego guardáramos, un fallo de
   Telegram borraría el lead del mundo. Así queda escrito, y si el aviso no
   sale, `entregado` se queda en 0 y el verificador lo encuentra esa noche. */
export async function registrarAviso(db, sesionId, clienteId, aviso) {
  const r = await db
    .prepare(
      'INSERT INTO avisos (sesion, cliente, titulo, cuerpo, cuando) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(sesionId, clienteId, aviso.titulo, aviso.cuerpo, ahora())
    .run();
  return r.meta.last_row_id;
}

export async function marcarEntregado(db, avisoId) {
  await db.prepare('UPDATE avisos SET entregado = 1 WHERE id = ?').bind(avisoId).run();
}

/* El hilo tal como lo ve su propio visitante, para volver a pintarlo cuando
   recarga la página.

   Se sirve desde aquí en vez de guardar una copia en el navegador a propósito:
   dos copias de la misma conversación es exactamente la forma de error que más
   caro sale — dos fuentes que se separan y nadie sabe cuál manda. El navegador
   pinta; la verdad vive en un solo lugar. */
export async function hiloVisitante(db, clienteId, sesionId) {
  const cabeza = await db
    .prepare('SELECT id FROM sesiones WHERE id = ? AND cliente = ?')
    .bind(sesionId, clienteId)
    .first();
  if (!cabeza) return null;

  const { results } = await db
    .prepare('SELECT rol, texto FROM mensajes WHERE sesion = ? ORDER BY id ASC')
    .bind(sesionId)
    .all();
  return results || [];
}

// ─── LO QUE LEE LA BANDEJA ─────────────────────────────────────────────────

export async function listarSesiones(db, clienteId, limite = 50) {
  const { results } = await db
    .prepare(
      'SELECT s.id, s.creada, s.vista, s.turnos, s.atendida, s.canal, ' +
        '(SELECT COUNT(*) FROM avisos a WHERE a.sesion = s.id) AS avisos, ' +
        '(SELECT texto FROM mensajes m WHERE m.sesion = s.id AND m.rol = ' +
        "'visitante' ORDER BY m.id ASC LIMIT 1) AS primera " +
        'FROM sesiones s WHERE s.cliente = ? ORDER BY s.vista DESC LIMIT ?'
    )
    .bind(clienteId, limite)
    .all();
  return results || [];
}

export async function leerSesion(db, clienteId, sesionId) {
  const cabeza = await db
    .prepare('SELECT id, creada, vista, turnos, atendida, canal FROM sesiones WHERE id = ? AND cliente = ?')
    .bind(sesionId, clienteId)
    .first();
  if (!cabeza) return null;

  const { results: mensajes } = await db
    .prepare('SELECT rol, texto, cuando FROM mensajes WHERE sesion = ? ORDER BY id ASC')
    .bind(sesionId)
    .all();
  const { results: avisos } = await db
    .prepare('SELECT titulo, cuerpo, cuando, entregado FROM avisos WHERE sesion = ? ORDER BY id ASC')
    .bind(sesionId)
    .all();

  return { ...cabeza, mensajes: mensajes || [], avisos: avisos || [] };
}

export async function marcarAtendida(db, clienteId, sesionId) {
  const r = await db
    .prepare('UPDATE sesiones SET atendida = 1 WHERE id = ? AND cliente = ?')
    .bind(sesionId, clienteId)
    .run();
  return r.meta.changes > 0;
}
