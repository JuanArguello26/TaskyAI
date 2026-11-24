-- Conversación en curso con el bot (ej: "¿cuántos ml tomó?" esperando respuesta)
CREATE TABLE chat_state (
  chat_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL
);
