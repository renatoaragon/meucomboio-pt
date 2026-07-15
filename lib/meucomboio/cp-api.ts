// MeuComboioPT: client for the travel-api used by the CP website (api-gateway).
// Credentials are the ones from CP's public frontend: we read /fe-config.json
// at runtime, so they stay valid even if CP rotates them.

const CONFIG_URL = "https://www.cp.pt/fe-config.json";
const TIMEOUT_MS = 6000;

type CpConfig = { travelApiUrl: string; travelApiKey: string; xcck: string; xccs: string };
let cachedConfig: { value: CpConfig; expiresAt: number } | null = null;

async function getConfig(): Promise<CpConfig> {
  if (cachedConfig && Date.now() < cachedConfig.expiresAt) return cachedConfig.value;
  const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fe-config ${res.status}`);
  const c = (await res.json()) as CpConfig;
  if (!c.travelApiUrl || !c.travelApiKey) throw new Error("fe-config incompleto");
  cachedConfig = { value: c, expiresAt: Date.now() + 6 * 60 * 60 * 1000 }; // 6h
  return c;
}

// GTFS uses "94_2006"; the travel-api uses "94-2006".
export const toApiCode = (stopId: string) => stopId.replace(/_/g, "-");

export type BasePrice = { travelClass?: number; priceType?: number; centsValue?: number };
export type TrainStop = {
  station?: { code?: string; designation?: string };
  arrival?: string; // "HH:MM"
  departure?: string;
  latitude?: string;
  longitude?: string;
  delay?: string | null;
};
export type TravelSection = {
  serviceCode?: { code?: string; designation?: string };
  trainNumber?: number;
  trainStops?: TrainStop[];
};
export type OutwardTrip = {
  departureTime?: string; // "HH:MM"
  arrivalTime?: string;
  services?: string;
  delay?: string | null;
  basePrices?: BasePrice[];
  travelSections?: TravelSection[];
};

// Journey search (the response carries prices AND stops with GPS/times).
export async function searchJourneys(fromStopId: string, toStopId: string, dateIso: string): Promise<OutwardTrip[]> {
  const cfg = await getConfig();
  const res = await fetch(`${cfg.travelApiUrl}/journeys`, {
    method: "POST",
    headers: {
      "X-Api-Key": cfg.travelApiKey,
      "x-cp-connect-id": cfg.xcck,
      "x-cp-connect-secret": cfg.xccs,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      departureStationCode: toApiCode(fromStopId),
      arrivalStationCode: toApiCode(toStopId),
      travelDate: dateIso,
      returnDate: null,
      classes: [1, 2],
      searchType: 3,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`journeys ${res.status}`);
  const data = (await res.json()) as { outwardTrip?: OutwardTrip[] };
  return data.outwardTrip ?? [];
}
