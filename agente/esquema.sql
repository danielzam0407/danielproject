-- Esquema del molde. Se aplica con:
--   npx wrangler d1 execute agente --remote --file=esquema.sql
--
-- Una sola base para todos los clientes: la columna `cliente` separa. Es más
-- barato de operar que una base por empresa, y las consultas de la bandeja
-- siempre filtran por ella.

-- Una conversación. El id lo genera el servidor, nunca el navegador.
CREATE TABLE IF NOT EXISTS sesiones (
  id        TEXT PRIMARY KEY,
  cliente   TEXT NOT NULL,
  creada    TEXT NOT NULL,
  vista     TEXT NOT NULL,            -- último turno; ordena la bandeja
  turnos    INTEGER NOT NULL DEFAULT 0,
  ip        TEXT,                     -- para cortar abuso, no para identificar
  atendida  INTEGER NOT NULL DEFAULT 0
);

-- Ordenar la bandeja por actividad es LA consulta de la bandeja. Sin este
-- índice, cada carga lee la tabla entera.
CREATE INDEX IF NOT EXISTS sesiones_por_actividad
  ON sesiones (cliente, vista DESC);

-- Los turnos. Sólo texto: nunca guardamos bloques crudos del modelo, porque
-- lo que se guarda es lo que después se le vuelve a dar de comer.
CREATE TABLE IF NOT EXISTS mensajes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion  TEXT NOT NULL,
  rol     TEXT NOT NULL CHECK (rol IN ('visitante', 'agente')),
  texto   TEXT NOT NULL,
  cuando  TEXT NOT NULL,
  FOREIGN KEY (sesion) REFERENCES sesiones(id)
);

CREATE INDEX IF NOT EXISTS mensajes_por_sesion
  ON mensajes (sesion, id);

-- Cada intención detectada. `entregado` es la columna que hace posible el
-- verificador: si un aviso quedó en 0, el lead existió y a ti no te llegó.
CREATE TABLE IF NOT EXISTS avisos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion     TEXT NOT NULL,
  cliente    TEXT NOT NULL,
  titulo     TEXT NOT NULL,
  cuerpo     TEXT NOT NULL,
  cuando     TEXT NOT NULL,
  entregado  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS avisos_sin_entregar
  ON avisos (entregado, cuando);
