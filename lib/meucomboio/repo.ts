// MeuComboioPT, consultas: estações, serviços ativos e planeamento de
// viagens diretas (sem transbordo) por feed.

import { prisma } from "@/lib/prisma";
import { lisbonNow, previousDate, secsToHHMM } from "./gtfs";
import { fetchPrices } from "./cp-prices";

export type Station = { feedId: string; stopId: string; name: string; lat: number; lon: number };

export type Journey = {
  feedId: string;
  route: string;
  headsign: string;
  departure: string;
  arrival: string;
  departureSecs: number;
  durationMin: number;
  stopsBetween: number;
  priceSecond: number | null; // euros, 2.ª classe (null se indisponível)
  priceFirst: number | null; // euros, 1.ª classe
};

export async function listStations(): Promise<Station[]> {
  return prisma.$queryRawUnsafe<Station[]>(
    `SELECT "feedId", "stopId", "name", "lat", "lon" FROM "meucomboio_stops" ORDER BY "name"`
  );
}

export async function feedStatus() {
  return prisma.$queryRawUnsafe<
    { id: string; name: string; lastSyncAt: Date | null; stopCount: number | null; tripCount: number | null; error: string | null }[]
  >(`SELECT "id", "name", "lastSyncAt", "stopCount", "tripCount", "error" FROM "meucomboio_feeds" ORDER BY "id"`);
}

const WEEKDAY_COLS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// service_ids ativos num dia de serviço: calendar (dia da semana + intervalo)
// corrigido pelas exceções de calendar_dates (1 adiciona, 2 remove).
async function activeServiceIds(feedId: string, dateInt: number, weekday: number): Promise<string[]> {
  const col = WEEKDAY_COLS[weekday];
  const rows = await prisma.$queryRawUnsafe<{ serviceId: string }[]>(
    `SELECT c."serviceId" FROM "meucomboio_calendar" c
     WHERE c."feedId" = $1 AND c."${col}" AND $2 BETWEEN c."startDate" AND c."endDate"
       AND NOT EXISTS (
         SELECT 1 FROM "meucomboio_calendar_dates" d
         WHERE d."feedId" = c."feedId" AND d."serviceId" = c."serviceId"
           AND d."date" = $2 AND d."exceptionType" = 2)
     UNION
     SELECT d."serviceId" FROM "meucomboio_calendar_dates" d
     WHERE d."feedId" = $1 AND d."date" = $2 AND d."exceptionType" = 1`,
    feedId,
    dateInt
  );
  return rows.map((r) => r.serviceId);
}

type RawJourney = {
  routeShort: string | null;
  routeLong: string | null;
  headsign: string | null;
  dep: number;
  arr: number;
  stopsBetween: number;
};

async function directTrips(
  feedId: string,
  fromStop: string,
  toStop: string,
  serviceIds: string[],
  minDeparture: number,
  limit: number
): Promise<RawJourney[]> {
  if (serviceIds.length === 0) return [];
  return prisma.$queryRawUnsafe<RawJourney[]>(
    `SELECT r."shortName" AS "routeShort", r."longName" AS "routeLong", t."headsign",
            a."departure" AS "dep", b."arrival" AS "arr", (b."seq" - a."seq" - 1)::int AS "stopsBetween"
     FROM "meucomboio_stop_times" a
     JOIN "meucomboio_stop_times" b
       ON b."feedId" = a."feedId" AND b."tripId" = a."tripId" AND b."seq" > a."seq"
     JOIN "meucomboio_trips" t ON t."feedId" = a."feedId" AND t."tripId" = a."tripId"
     JOIN "meucomboio_routes" r ON r."feedId" = t."feedId" AND r."routeId" = t."routeId"
     WHERE a."feedId" = $1 AND a."stopId" = $2 AND b."stopId" = $3
       AND t."serviceId" = ANY($4) AND a."departure" >= $5
     ORDER BY a."departure"
     LIMIT $6`,
    feedId,
    fromStop,
    toStop,
    serviceIds,
    minDeparture,
    limit
  );
}

// Próximas viagens diretas a partir de agora (hora de Lisboa). Consulta o
// serviço de hoje e também o de ontem (para horários GTFS >= 24h, i.e.
// comboios de madrugada que pertencem ao dia de serviço anterior).
export async function planJourneys(feedId: string, fromStop: string, toStop: string, limit = 8): Promise<Journey[]> {
  const { dateInt, weekday, secs } = lisbonNow();
  const yDate = previousDate(dateInt);
  const yWeekday = (weekday + 6) % 7;

  const [todayServices, yesterdayServices] = await Promise.all([
    activeServiceIds(feedId, dateInt, weekday),
    activeServiceIds(feedId, yDate, yWeekday),
  ]);

  const [today, yesterday] = await Promise.all([
    directTrips(feedId, fromStop, toStop, todayServices, secs, limit),
    directTrips(feedId, fromStop, toStop, yesterdayServices, secs + 86400, limit),
  ]);

  // Normaliza os de ontem para o relógio de hoje (dep - 86400) e ordena tudo.
  const all = [
    ...today.map((j) => ({ ...j, clockDep: j.dep, clockArr: j.arr })),
    ...yesterday.map((j) => ({ ...j, clockDep: j.dep - 86400, clockArr: j.arr - 86400 })),
  ].sort((a, b) => a.clockDep - b.clockDep);

  const selected = all.slice(0, limit);

  // Preços só para a CP (a travel-api é exclusiva da CP). Casa por hora de
  // partida ("HH:MM"). Best-effort: se falhar, os preços ficam a null.
  const iso = `${Math.floor(dateInt / 10000)}-${String(Math.floor((dateInt % 10000) / 100)).padStart(2, "0")}-${String(dateInt % 100).padStart(2, "0")}`;
  const priceMap = feedId === "cp" && selected.length > 0
    ? await fetchPrices(fromStop, toStop, iso)
    : new Map();

  return selected.map((j) => {
    const departure = secsToHHMM(j.clockDep);
    const price = priceMap.get(departure);
    return {
      feedId,
      route: j.routeLong || j.routeShort || "Comboio",
      headsign: j.headsign || "",
      departure,
      arrival: secsToHHMM(j.clockArr),
      departureSecs: j.clockDep,
      durationMin: Math.round((j.clockArr - j.clockDep) / 60),
      stopsBetween: Number(j.stopsBetween),
      priceSecond: price?.second ?? null,
      priceFirst: price?.first ?? null,
    };
  });
}
