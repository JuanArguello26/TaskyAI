-- Avisos previos de recordatorios (1 = ya enviado / no aplica)
ALTER TABLE reminders ADD COLUMN pre_60_sent INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reminders ADD COLUMN pre_10_sent INTEGER NOT NULL DEFAULT 1;
-- Qué registrar al tocar "✅ Hecho": medicine:<nombre> | tummy | bath | null
ALTER TABLE reminders ADD COLUMN action TEXT;
-- Fin de un tratamiento (los repetitivos se apagan solos)
ALTER TABLE reminders ADD COLUMN ends_at INTEGER;

-- Controles: aviso 12 h antes y evento de Google Calendar
ALTER TABLE appointments ADD COLUMN notified_12h INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN gcal_event_id TEXT;

-- Libreta de notas ("anota: comprar pañales")
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notes ON notes(done, created_at);
