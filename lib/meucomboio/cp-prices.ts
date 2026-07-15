// MeuComboioPT: per-train prices, derived from CP's travel-api.
// Best-effort: any failure returns an empty map and the app shows timetables
// without prices; it never blocks the main query.

import { searchJourneys } from "./cp-api";

export type PriceInfo = { second: number | null; first: number | null }; // euros
export type PriceMap = Map<string, PriceInfo>; // keyed by "HH:MM" (departure)

export async function fetchPrices(fromStopId: string, toStopId: string, dateIso: string): Promise<PriceMap> {
  const prices: PriceMap = new Map();
  try {
    const trips = await searchJourneys(fromStopId, toStopId, dateIso);
    for (const trip of trips) {
      const dep = (trip.departureTime ?? "").slice(0, 5);
      if (!dep) continue;
      const cents = (cls: number) =>
        (trip.basePrices ?? [])
          .filter((p) => Number(p.travelClass) === cls && typeof p.centsValue === "number")
          .map((p) => p.centsValue as number)
          .sort((a, b) => a - b)[0];
      const c2 = cents(2);
      const c1 = cents(1);
      prices.set(dep, { second: c2 != null ? c2 / 100 : null, first: c1 != null ? c1 / 100 : null });
    }
  } catch (err) {
    console.warn("[meucomboio] preços CP indisponíveis:", err instanceof Error ? err.message : err);
  }
  return prices;
}
