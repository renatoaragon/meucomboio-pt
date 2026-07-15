-- MeuComboioPT: GTFS tables (train timetables).
--
-- The schema is plain SQL by design: GTFS is a stable, well-known relational
-- model and every query in the app is hand-written SQL through $queryRaw.
-- The script is idempotent (CREATE ... IF NOT EXISTS), so it doubles as the
-- migration mechanism: re-run it after pulling a version that adds tables.
--
-- Multi-operator model: every table carries "feedId" (e.g. 'cp', 'fertagus')
-- because GTFS ids are only unique within a feed.
-- Times are stored as seconds since midnight of the SERVICE day (INTEGER):
-- GTFS allows values past 24h (e.g. 25:10 is the 1:10am train that belongs
-- to the previous day's service).
--
-- Apply once (wherever DATABASE_URL points):
--   npm run db:init

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

-- Backs the core planning query (departures by station).
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
  "exceptionType" INTEGER NOT NULL, -- 1 = added, 2 = removed
  PRIMARY KEY ("feedId", "serviceId", "date")
);

CREATE INDEX IF NOT EXISTS "meucomboio_calendar_dates_date_idx"
  ON "meucomboio_calendar_dates" ("feedId", "date");

-- One row per ingestion attempt: counts, data quality warnings, duration.
-- Failed runs (download error or quality gate rejection) are recorded too,
-- with "ok" = false and the reason in "error". Append-only log; on purpose
-- there is no FK to feeds so a rejected first-ever run is still recorded.
CREATE TABLE IF NOT EXISTS "meucomboio_sync_runs" (
  "id"            BIGSERIAL PRIMARY KEY,
  "feedId"        TEXT NOT NULL,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ok"            BOOLEAN NOT NULL,
  "stops"         INTEGER,
  "routes"        INTEGER,
  "trips"         INTEGER,
  "stopTimes"     INTEGER,
  "warnings"      JSONB NOT NULL DEFAULT '[]',
  "error"         TEXT,
  "durationMs"    INTEGER
);

CREATE INDEX IF NOT EXISTS "meucomboio_sync_runs_feed_idx"
  ON "meucomboio_sync_runs" ("feedId", "startedAt");
