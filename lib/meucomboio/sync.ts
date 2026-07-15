// GTFS ingestion: downloads each operator's feed and reloads PostgreSQL.
//
// Pipeline per feed:
//   download zip -> parse CSVs -> data quality gate -> transactional swap
//
// The swap is a full replace (delete + insert inside one transaction): GTFS
// is a complete snapshot, not a delta. If the quality gate finds any error
// (truncated file, broken references, expired calendar, suspicious drift
// against the previous load) the feed is rejected and the database keeps
// serving the previous snapshot. Every attempt is recorded in
// meucomboio_sync_runs with counts, warnings and duration.

import AdmZip from "adm-zip";
import { prisma } from "@/lib/prisma";
import { parseCsv, timeToSecs, lisbonNow } from "./gtfs";
import { checkFeedQuality, hasErrors, summarize, type PreviousCounts, type QualityIssue } from "./quality";

// Supported operators. To add another one (e.g. Fertagus once its public zip
// is confirmed), append it here and trigger a sync.
export const FEEDS = [
  { id: "cp", name: "CP - Comboios de Portugal", url: "https://publico.cp.pt/gtfs/gtfs.zip" },
] as const;

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

export type SyncResult = {
  feedId: string;
  ok: boolean;
  stops?: number;
  routes?: number;
  trips?: number;
  stopTimes?: number;
  warnings?: QualityIssue[];
  error?: string;
  durationMs: number;
};

async function previousCounts(feedId: string): Promise<PreviousCounts> {
  const rows = await prisma.$queryRawUnsafe<{ stops: number; trips: number; stopTimes: number }[]>(
    `SELECT "stops", "trips", "stopTimes" FROM "meucomboio_sync_runs"
     WHERE "feedId" = ${esc(feedId)} AND "ok" = true
     ORDER BY "startedAt" DESC LIMIT 1`,
  );
  if (rows.length) return rows[0];
  // Fallback for databases loaded before sync runs existed.
  const feeds = await prisma.$queryRawUnsafe<{ stopCount: number | null; tripCount: number | null }[]>(
    `SELECT "stopCount", "tripCount" FROM "meucomboio_feeds" WHERE "id" = ${esc(feedId)}`,
  );
  if (feeds.length && feeds[0].stopCount) {
    return { stops: feeds[0].stopCount ?? 0, trips: feeds[0].tripCount ?? 0, stopTimes: 0 };
  }
  return null;
}

async function recordRun(feedId: string, run: Omit<SyncResult, "feedId">) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "meucomboio_sync_runs"
       ("feedId","ok","stops","routes","trips","stopTimes","warnings","error","durationMs")
     VALUES (
       ${esc(feedId)}, ${run.ok ? "true" : "false"},
       ${run.stops ?? "NULL"}, ${run.routes ?? "NULL"}, ${run.trips ?? "NULL"}, ${run.stopTimes ?? "NULL"},
       ${esc(JSON.stringify(run.warnings ?? []))}::jsonb,
       ${run.error ? esc(run.error) : "NULL"},
       ${Math.round(run.durationMs)}
     )`,
  );
}

export async function syncFeed(feed: { id: string; name: string; url: string }): Promise<SyncResult> {
  const startedAt = Date.now();

  const res = await fetch(feed.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${feed.url}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const file = (name: string) => {
    const entry = zip.getEntry(name);
    return entry ? parseCsv(entry.getData().toString("utf-8")) : [];
  };

  // Parse into typed rows first: the quality gate needs real ids, not
  // SQL-escaped tuples.
  const stops = file("stops.txt")
    .filter((s) => s.stop_id && s.stop_lat && s.stop_lon)
    .map((s) => ({ id: s.stop_id, name: s.stop_name || s.stop_id, lat: Number(s.stop_lat), lon: Number(s.stop_lon) }));

  const routes = file("routes.txt")
    .filter((r) => r.route_id)
    .map((r) => ({ id: r.route_id, shortName: r.route_short_name || "", longName: r.route_long_name || "", type: Number(r.route_type || 2) || 2 }));

  const trips = file("trips.txt")
    .filter((t) => t.trip_id && t.route_id && t.service_id)
    .map((t) => ({ id: t.trip_id, routeId: t.route_id, serviceId: t.service_id, headsign: t.trip_headsign || "" }));

  const stopTimes: { tripId: string; stopId: string; seq: number; arrival: number; departure: number }[] = [];
  for (const st of file("stop_times.txt")) {
    const arrival = timeToSecs(st.arrival_time) ?? timeToSecs(st.departure_time);
    const departure = timeToSecs(st.departure_time) ?? arrival;
    if (!st.trip_id || !st.stop_id || arrival === null || departure === null) continue;
    stopTimes.push({ tripId: st.trip_id, stopId: st.stop_id, seq: Number(st.stop_sequence), arrival, departure });
  }

  const calendar = file("calendar.txt")
    .filter((c) => c.service_id)
    .map((c) => ({
      serviceId: c.service_id,
      days: [c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday, c.sunday].map((v) => v === "1"),
      startDate: Number(c.start_date),
      endDate: Number(c.end_date),
    }));

  const calendarDates = file("calendar_dates.txt")
    .filter((c) => c.service_id && c.date)
    .map((c) => ({ serviceId: c.service_id, date: Number(c.date), exceptionType: Number(c.exception_type) || 1 }));

  // Quality gate: reject the snapshot before touching the database.
  const previous = await previousCounts(feed.id);
  const issues = checkFeedQuality(
    { stops, routes, trips, stopTimes, calendar, calendarDates },
    lisbonNow().dateInt,
    previous,
  );
  const warnings = issues.filter((i) => i.severity === "warning");
  if (hasErrors(issues)) {
    const error = `quality gate rejected the feed: ${summarize(issues.filter((i) => i.severity === "error"))}`;
    await recordRun(feed.id, { ok: false, stops: stops.length, routes: routes.length, trips: trips.length, stopTimes: stopTimes.length, warnings, error, durationMs: Date.now() - startedAt });
    throw new Error(error);
  }

  const f = esc(feed.id);
  const stopRows = stops.map((s) => [f, esc(s.id), esc(s.name), String(s.lat), String(s.lon)]);
  const routeRows = routes.map((r) => [f, esc(r.id), esc(r.shortName), esc(r.longName), String(r.type)]);
  const tripRows = trips.map((t) => [f, esc(t.id), esc(t.routeId), esc(t.serviceId), esc(t.headsign)]);
  const stopTimeRows = stopTimes.map((st) => [f, esc(st.tripId), esc(st.stopId), String(st.seq), String(st.arrival), String(st.departure)]);
  const calendarRows = calendar.map((c) => [f, esc(c.serviceId), ...c.days.map((d) => (d ? "true" : "false")), String(c.startDate), String(c.endDate)]);
  const calendarDateRows = calendarDates.map((c) => [f, esc(c.serviceId), String(c.date), String(c.exceptionType)]);

  await prisma.$transaction(
    async (tx) => {
      for (const t of ["meucomboio_stop_times", "meucomboio_trips", "meucomboio_routes", "meucomboio_stops", "meucomboio_calendar", "meucomboio_calendar_dates"]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "feedId" = ${f}`);
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO "meucomboio_feeds" ("id","name","url") VALUES (${f},${esc(feed.name)},${esc(feed.url)})
         ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "url" = EXCLUDED."url"`
      );
      const insert = async (table: string, columns: string[], rows: string[][]) => {
        const cols = columns.map((c) => `"${c}"`).join(",");
        for (let i = 0; i < rows.length; i += 800) {
          const values = rows.slice(i, i + 800).map((r) => `(${r.join(",")})`).join(",");
          await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols}) VALUES ${values}`);
        }
      };
      await insert("meucomboio_stops", ["feedId", "stopId", "name", "lat", "lon"], stopRows);
      await insert("meucomboio_routes", ["feedId", "routeId", "shortName", "longName", "type"], routeRows);
      await insert("meucomboio_trips", ["feedId", "tripId", "routeId", "serviceId", "headsign"], tripRows);
      await insert("meucomboio_stop_times", ["feedId", "tripId", "stopId", "seq", "arrival", "departure"], stopTimeRows);
      await insert("meucomboio_calendar", ["feedId", "serviceId", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "startDate", "endDate"], calendarRows);
      await insert("meucomboio_calendar_dates", ["feedId", "serviceId", "date", "exceptionType"], calendarDateRows);
      await tx.$executeRawUnsafe(
        `UPDATE "meucomboio_feeds" SET "lastSyncAt" = CURRENT_TIMESTAMP, "stopCount" = ${stops.length}, "tripCount" = ${trips.length}, "error" = NULL WHERE "id" = ${f}`
      );
    },
    { timeout: 5 * 60 * 1000 }
  );

  const result: SyncResult = {
    feedId: feed.id,
    ok: true,
    stops: stops.length,
    routes: routes.length,
    trips: trips.length,
    stopTimes: stopTimes.length,
    warnings,
    durationMs: Date.now() - startedAt,
  };
  await recordRun(feed.id, result);
  return result;
}

export async function syncAllFeeds(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const feed of FEEDS) {
    const startedAt = Date.now();
    try {
      results.push(await syncFeed(feed));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[meucomboio] sync ${feed.id} failed:`, err);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "meucomboio_feeds" ("id","name","url","error") VALUES (${esc(feed.id)},${esc(feed.name)},${esc(feed.url)},${esc(message)})
         ON CONFLICT ("id") DO UPDATE SET "error" = EXCLUDED."error"`
      );
      // Runs rejected by the quality gate are already recorded inside
      // syncFeed; this covers download/parse/transaction failures.
      if (!message.startsWith("quality gate")) {
        await recordRun(feed.id, { ok: false, error: message, durationMs: Date.now() - startedAt }).catch(() => undefined);
      }
      results.push({ feedId: feed.id, ok: false, error: message, durationMs: Date.now() - startedAt });
    }
  }
  return results;
}

/** Last sync runs, newest first (feeds the GET /sync status endpoint). */
export async function recentSyncRuns(limit = 20) {
  return prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT "feedId", "startedAt", "ok", "stops", "routes", "trips", "stopTimes",
            "warnings", "error", "durationMs"
     FROM "meucomboio_sync_runs" ORDER BY "startedAt" DESC LIMIT ${Math.min(100, Math.max(1, limit))}`,
  );
}
