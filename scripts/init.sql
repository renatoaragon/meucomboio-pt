-- MeuComboioPT — tabelas GTFS (horários de comboios) no banco compartilhado.
--
-- ⚠️ O schema Prisma deste projeto é "generate only" (migrações vêm do
-- PsycoHub). Como no MyBoard e Work in Portugal, as tabelas são criadas por
-- este script idempotente, com prefixo meucomboio_ para nunca colidir.
--
-- Modelo multi-operador: todas as tabelas têm "feedId" (ex.: 'cp',
-- 'fertagus') porque os IDs do GTFS só são únicos dentro de cada feed.
-- Horários guardados como segundos desde a meia-noite do dia de serviço
-- (INTEGER), porque o GTFS permite valores >24h (ex.: 25:10 = comboio da
-- 1h10 da madrugada que pertence ao serviço do dia anterior).
--
-- Como aplicar (uma vez, no servidor onde DATABASE_URL aponta):
--   npm run meucomboio:init

CREATE TABLE IF NOT EXISTS "meucomboio_feeds" (
  "id"         TEXT PRIMARY KEY,
  "name"       TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "lastSyncAt" TIMESTAMP(3),
  "stopCount"  INTEGER,
  "tripCount"  INTEGER,
  "error"      TEXT
);

CREATE TABLE IF NOT EXISTS "meucomboio_stops" (
  "feedId" TEXT NOT NULL,
  "stopId" TEXT NOT NULL,
  "name"   TEXT NOT NULL,
  "lat"    DOUBLE PRECISION NOT NULL,
  "lon"    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY ("feedId", "stopId")
);

CREATE TABLE IF NOT EXISTS "meucomboio_routes" (
  "feedId"    TEXT NOT NULL,
  "routeId"   TEXT NOT NULL,
  "shortName" TEXT,
  "longName"  TEXT,
  "type"      INTEGER,
  PRIMARY KEY ("feedId", "routeId")
);

CREATE TABLE IF NOT EXISTS "meucomboio_trips" (
  "feedId"    TEXT NOT NULL,
  "tripId"    TEXT NOT NULL,
  "routeId"   TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "headsign"  TEXT,
  PRIMARY KEY ("feedId", "tripId")
);

CREATE INDEX IF NOT EXISTS "meucomboio_trips_service_idx"
  ON "meucomboio_trips" ("feedId", "serviceId");

CREATE TABLE IF NOT EXISTS "meucomboio_stop_times" (
  "feedId"    TEXT NOT NULL,
  "tripId"    TEXT NOT NULL,
  "stopId"    TEXT NOT NULL,
  "seq"       INTEGER NOT NULL,
  "arrival"   INTEGER NOT NULL,
  "departure" INTEGER NOT NULL,
  PRIMARY KEY ("feedId", "tripId", "seq")
);

-- Índice que sustenta a consulta de planeamento (partidas por estação).
CREATE INDEX IF NOT EXISTS "meucomboio_stop_times_stop_idx"
  ON "meucomboio_stop_times" ("feedId", "stopId", "departure");

CREATE TABLE IF NOT EXISTS "meucomboio_calendar" (
  "feedId"    TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "mon" BOOLEAN NOT NULL, "tue" BOOLEAN NOT NULL, "wed" BOOLEAN NOT NULL,
  "thu" BOOLEAN NOT NULL, "fri" BOOLEAN NOT NULL, "sat" BOOLEAN NOT NULL,
  "sun" BOOLEAN NOT NULL,
  "startDate" INTEGER NOT NULL, -- yyyymmdd
  "endDate"   INTEGER NOT NULL,
  PRIMARY KEY ("feedId", "serviceId")
);

CREATE TABLE IF NOT EXISTS "meucomboio_calendar_dates" (
  "feedId"        TEXT NOT NULL,
  "serviceId"     TEXT NOT NULL,
  "date"          INTEGER NOT NULL, -- yyyymmdd
  "exceptionType" INTEGER NOT NULL, -- 1 = adiciona, 2 = remove
  PRIMARY KEY ("feedId", "serviceId", "date")
);

CREATE INDEX IF NOT EXISTS "meucomboio_calendar_dates_date_idx"
  ON "meucomboio_calendar_dates" ("feedId", "date");
