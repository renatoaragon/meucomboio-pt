// MeuComboioPT: direções e tempo do utilizador até à estação, por modo de
// transporte. Usa o OpenRouteService (chamado do servidor, chave em
// MEUCOMBOIO_ORS_KEY) para rotas e instruções reais. Sem chave, cai para uma
// estimativa por distância em linha reta (sem instruções passo-a-passo).

export type TravelMode = "foot" | "bike" | "car";

export type Directions = {
  mode: TravelMode;
  durationMin: number;
  distanceKm: number;
  geometry: [number, number][]; // [lon, lat]
  steps: { instruction: string; distanceM: number }[];
  estimated: boolean; // true = estimativa por distância (sem ORS)
};

const ORS_PROFILE: Record<TravelMode, string> = {
  foot: "foot-walking",
  bike: "cycling-regular",
  car: "driving-car",
};

// Velocidades médias urbanas para a estimativa de fallback (km/h) e fator de
// desvio (a rua real é mais longa que a linha reta).
const FALLBACK_KMH: Record<TravelMode, number> = { foot: 4.8, bike: 15, car: 30 };
const DETOUR_FACTOR = 1.35;

const hav = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180;
  const dLat = (c - a) * r;
  const dLon = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); // km
};

function estimate(from: { lat: number; lon: number }, to: { lat: number; lon: number }, mode: TravelMode): Directions {
  const straight = hav(from.lat, from.lon, to.lat, to.lon);
  const distanceKm = straight * DETOUR_FACTOR;
  return {
    mode,
    durationMin: Math.max(1, Math.round((distanceKm / FALLBACK_KMH[mode]) * 60)),
    distanceKm,
    geometry: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    steps: [],
    estimated: true,
  };
}

type OrsResponse = {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: {
      summary?: { distance?: number; duration?: number };
      segments?: { steps?: { instruction?: string; distance?: number }[] }[];
    };
  }[];
};

export async function fetchDirections(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  mode: TravelMode
): Promise<Directions> {
  const key = process.env.MEUCOMBOIO_ORS_KEY;
  if (!key) return estimate(from, to, mode);

  try {
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${ORS_PROFILE[mode]}/geojson`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
        language: "pt", // instruções em português
        units: "m",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`ors ${res.status}`);
    const data = (await res.json()) as OrsResponse;
    const feat = data.features?.[0];
    const summary = feat?.properties?.summary;
    if (!feat?.geometry?.coordinates || !summary?.duration) throw new Error("ors sem rota");

    const steps = (feat.properties?.segments ?? [])
      .flatMap((s) => s.steps ?? [])
      .map((st) => ({ instruction: st.instruction ?? "", distanceM: Math.round(st.distance ?? 0) }))
      .filter((s) => s.instruction);

    return {
      mode,
      durationMin: Math.max(1, Math.round(summary.duration / 60)),
      distanceKm: (summary.distance ?? 0) / 1000,
      geometry: feat.geometry.coordinates,
      steps,
      estimated: false,
    };
  } catch (err) {
    console.warn("[meucomboio] ORS indisponível, a estimar:", err instanceof Error ? err.message : err);
    return estimate(from, to, mode);
  }
}
