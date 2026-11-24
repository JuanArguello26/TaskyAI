-- Todas las fechas se guardan como milisegundos UTC (INTEGER).

-- Registros de la bebé: comida, sueño, pañal, baño, medicina, temperatura, peso, nota
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER,              -- NULL = sueño en curso
  detail TEXT,                 -- pecho_izq | pecho_der | biberon | formula | pipi | popo | ambos | nombre medicina
  amount REAL,                 -- ml, minutos, °C o kg
  note TEXT,
  author TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_entries_kind_start ON entries(kind, start_at);
CREATE INDEX idx_entries_start ON entries(start_at);

-- Controles médicos, vacunas, citas
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  at INTEGER NOT NULL,
  place TEXT,
  notes TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  notified_24h INTEGER NOT NULL DEFAULT 0,
  notified_2h INTEGER NOT NULL DEFAULT 0,
  author TEXT
);
CREATE INDEX idx_appointments ON appointments(done, at);

-- Recordatorios (únicos o repetitivos)
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  repeat_minutes INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  author TEXT
);
CREATE INDEX idx_reminders ON reminders(active, due_at);

-- Papá, mamá y quien se vincule al bot de Telegram
CREATE TABLE caregivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  chat_id TEXT NOT NULL UNIQUE,
  notify_others INTEGER NOT NULL DEFAULT 1
);

-- Ajustes (fecha de nacimiento, etc.)
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Intentos fallidos de PIN (para bloquear a quien intente adivinarlo)
CREATE TABLE auth_fails (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_auth_fails ON auth_fails(key, ts);
