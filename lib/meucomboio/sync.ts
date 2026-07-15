// MeuComboioPT: descarrega o GTFS de cada operador e carrega no Postgres.
// Substituição total por feed (delete + insert em transação): o GTFS é um
// snapshot completo, não um delta.

import AdmZip from "adm-zip";
import { prisma } from "@/lib/prisma";
import { parseCsv, timeToSecs } from "./gtfs";

// Operadores suportados. Para adicionar outro (ex.: Fertagus quando o zip
// público estiver confirmado), basta acrescentar aqui e correr o sync.
export const FEEDS = [
  { id: "cp", name: "CP - Comboios de Portugal", url: "https://publico.cp.pt/gtfs/gtfs.zip" },
] as const;

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function syncFeed(feed: { id: string; name: string; url: string }) {
  const res = await fetch(feed.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download falhou (${res.status}) em ${feed.url}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const file = (name: string) => {
    const entry = zip.getEntry(name);
    return entry ? parseCsv(entry.getData().toString("utf-8")) : [];
  };

  const f = esc(feed.id);

  const stops = file("stops.txt")
    .filter((s) => s.stop_id && s.stop_lat && s.stop_lon)
    .map((s) => [f, esc(s.stop_id), esc(s.stop_name || s.stop_id), String(Number(s.stop_lat)), String(Number(s.stop_lon))]);

  const routes = file("routes.txt")
    .filter((r) => r.route_id)
    .map((r) => [f, esc(r.route_id), esc(r.route_short_name || ""), esc(r.route_long_name || ""), String(Number(r.route_type || 2) || 2)]);

  const trips = file("trips.txt")
    .filter((t) => t.trip_id && t.route_id && t.service_id)
    .map((t) => [f, esc(t.trip_id), esc(t.route_id), esc(t.service_id), esc(t.trip_headsign || "")]);

  const stopTimes: string[][] = [];
  for (const st of file("stop_times.txt")) {
    const arrival = timeToSecs(st.arrival_time) ?? timeToSecs(st.departure_time);
    const departure = timeToSecs(st.departure_time) ?? arrival;
    if (!st.trip_id || !st.stop_id || arrival === null || departure === null) continue;
    stopTimes.push([f, esc(st.trip_id), esc(st.stop_id), String(Number(st.stop_sequence)), String(arrival), String(departure)]);
  }

  const bool = (v: string) => (v === "1" ? "true" : "false");
  const calendar = file("calendar.txt")
    .filter((c) => c.service_id)
    .map((c) => [
      f, esc(c.service_id),
      bool(c.monday), bool(c.tuesday), bool(c.wednesday), bool(c.thursday),
      bool(c.friday), bool(c.saturday), bool(c.sunday),
      String(Number(c.start_date)), String(Number(c.end_date)),
    ]);

  const calendarDates = file("calendar_dates.txt")
    .filter((c) => c.service_id && c.date)
    .map((c) => [f, esc(c.service_id), String(Number(c.date)), String(Number(c.exception_type) || 1)]);

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
      await insert("meucomboio_stops", ["feedId", "stopId", "name", "lat", "lon"], stops);
      await insert("meucomboio_routes", ["feedId", "routeId", "shortName", "longName", "type"], routes);
      await insert("meucomboio_trips", ["feedId", "tripId", "routeId", "serviceId", "headsign"], trips);
      await insert("meucomboio_stop_times", ["feedId", "tripId", "stopId", "seq", "arrival", "departure"], stopTimes);
      await insert("meucomboio_calendar", ["feedId", "serviceId", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "startDate", "endDate"], calendar);
      await insert("meucomboio_calendar_dates", ["feedId", "serviceId", "date", "exceptionType"], calendarDates);
      await tx.$executeRawUnsafe(
        `UPDATE "meucomboio_feeds" SET "lastSyncAt" = CURRENT_TIMESTAMP, "stopCount" = ${stops.length}, "tripCount" = ${trips.length}, "error" = NULL WHERE "id" = ${f}`
      );
    },
    { timeout: 5 * 60 * 1000 }
  );

  return { feedId: feed.id, stops: stops.length, trips: trips.length, stopTimes: stopTimes.length };
}

export async function syncAllFeeds() {
  const results = [];
  for (const feed of FEEDS) {
    try {
      results.push({ ok: true, ...(await syncFeed(feed)) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[meucomboio] sync ${feed.id} falhou:`, err);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "meucomboio_feeds" ("id","name","url","error") VALUES (${esc(feed.id)},${esc(feed.name)},${esc(feed.url)},${esc(message)})
         ON CONFLICT ("id") DO UPDATE SET "error" = EXCLUDED."error"`
      );
      results.push({ ok: false, feedId: feed.id, error: message });
    }
  }
  return results;
}
