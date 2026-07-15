"use client";

// MeuComboioPT (cliente): geolocalização → estação mais próxima, escolha de
// destino com autocomplete e listagem dos próximos comboios diretos.
// A lista de estações vem inteira do servidor (~centenas de registos), por
// isso a estação mais próxima e o autocomplete são calculados no browser.

import { useEffect, useMemo, useRef, useState } from "react";
import { TripMapModal } from "./trip-map-modal";

type Station = { feedId: string; stopId: string; name: string; lat: number; lon: number };
type Feed = { id: string; name: string; lastSyncAt: string | null; error: string | null };
type Journey = {
  route: string;
  headsign: string;
  departure: string;
  arrival: string;
  departureSecs: number;
  durationMin: number;
  stopsBetween: number;
  priceSecond: number | null;
  priceFirst: number | null;
};

const euro = (v: number) =>
  v.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

type TravelMode = "foot" | "bike" | "car";
type Directions = {
  mode: TravelMode;
  durationMin: number;
  distanceKm: number;
  steps: { instruction: string; distanceM: number }[];
  estimated: boolean;
};

const MODES: { id: TravelMode; label: string; icon: string }[] = [
  { id: "foot", label: "A pé", icon: "🚶" },
  { id: "bike", label: "Bicicleta", icon: "🚲" },
  { id: "car", label: "Carro/mota", icon: "🚗" },
];

// "Como chegar à estação de partida" a partir da localização atual, por modo,
// com aviso se dá tempo para o próximo comboio (soonestMins).
function AccessDirections({
  userPos,
  station,
  soonestMins,
}: {
  userPos: { lat: number; lon: number };
  station: Station;
  soonestMins: number | null;
}) {
  const [mode, setMode] = useState<TravelMode>("foot");
  const [data, setData] = useState<Directions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      setData(null);
      setShowSteps(false);
      const params = new URLSearchParams({
        fLat: String(userPos.lat),
        fLon: String(userPos.lon),
        tLat: String(station.lat),
        tLon: String(station.lon),
        mode,
      });
      try {
        const r = await fetch(`/api/meucomboio/route?${params}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? "Erro.");
        if (alive) setData(d.directions as Directions);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Erro.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [userPos, station, mode]);

  const onTime =
    data && soonestMins != null ? (soonestMins - data.durationMin >= 3 ? "ok" : soonestMins - data.durationMin >= 0 ? "tight" : "late") : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="mb-3 text-sm font-bold text-white/80">Como chegar a {station.name}</p>
      <div className="flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 rounded-xl border px-2 py-2 text-sm font-semibold transition ${
              mode === m.id ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            <span className="mr-1">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {loading && <p className="mt-3 text-sm text-white/50">A calcular…</p>}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {data && (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black tabular-nums text-white">{data.durationMin} min</span>
            <span className="text-sm text-white/50">
              · {data.distanceKm < 1 ? `${Math.round(data.distanceKm * 1000)} m` : `${data.distanceKm.toFixed(1)} km`}
            </span>
          </div>

          {onTime && (
            <p
              className={`mt-1 text-sm font-semibold ${
                onTime === "ok" ? "text-emerald-300" : onTime === "tight" ? "text-amber-300" : "text-red-300"
              }`}
            >
              {onTime === "ok"
                ? `✅ Dá tempo: o comboio parte em ${soonestMins} min`
                : onTime === "tight"
                  ? `⚠️ Apertado: o comboio parte em ${soonestMins} min`
                  : `❌ Não chegas: o comboio parte em ${soonestMins} min`}
            </p>
          )}

          {data.steps.length > 0 ? (
            <>
              <button
                onClick={() => setShowSteps((v) => !v)}
                className="mt-2 text-xs font-semibold text-emerald-300/80 hover:text-emerald-200"
              >
                {showSteps ? "Ocultar direções" : "Ver direções passo-a-passo"}
              </button>
              {showSteps && (
                <ol className="mt-2 space-y-1.5 border-l-2 border-white/10 pl-3">
                  {data.steps.map((s, i) => (
                    <li key={i} className="text-xs text-white/60">
                      {s.instruction}
                      {s.distanceM > 0 && <span className="text-white/30"> · {s.distanceM} m</span>}
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            data.estimated && <p className="mt-2 text-xs text-white/30">Tempo estimado por distância.</p>
          )}
        </div>
      )}
    </div>
  );
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Minutos até uma partida (departureSecs é relógio de Lisboa em segundos).
function minutesUntil(departureSecs: number) {
  const now = new Date().toLocaleString("en-GB", { timeZone: "Europe/Lisbon", hour12: false });
  const m = /(\d{2}):(\d{2}):(\d{2})/.exec(now);
  if (!m) return null;
  const nowSecs = Number(m[1]) % 24 * 3600 + Number(m[2]) * 60 + Number(m[3]);
  let diff = departureSecs - nowSecs;
  if (diff < -43200) diff += 86400; // partida já no dia seguinte
  return Math.round(diff / 60);
}

function StationPicker({
  label,
  stations,
  selected,
  onSelect,
  placeholder,
  hint,
}: {
  label: string;
  stations: Station[];
  selected: Station | null;
  onSelect: (s: Station | null) => void;
  placeholder: string;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return [];
    return stations.filter((s) => norm(s.name).includes(q)).slice(0, 8);
  }, [query, stations]);

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </label>
      {selected ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3">
          <div>
            <p className="font-bold text-white">{selected.name}</p>
            {hint && <p className="text-xs text-white/50">{hint}</p>}
          </div>
          <button
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            className="rounded-full px-3 py-1 text-xs font-semibold text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            Alterar
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-emerald-400/50"
          />
          {open && matches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-white/10 bg-[#101826] shadow-xl">
              {matches.map((s) => (
                <li key={`${s.feedId}:${s.stopId}`}>
                  <button
                    onClick={() => {
                      onSelect(s);
                      setOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/10"
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function MeuComboioClient() {
  const [stations, setStations] = useState<Station[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Station | null>(null);
  const [originDistanceKm, setOriginDistanceKm] = useState<number | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "asking" | "ok" | "denied">("idle");
  const [destination, setDestination] = useState<Station | null>(null);
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openTrip, setOpenTrip] = useState<Journey | null>(null);

  useEffect(() => {
    fetch("/api/meucomboio/stations")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        setStations(data.stations);
        setFeeds(data.feeds);
      })
      .catch(() => setLoadError("Não foi possível carregar a base de estações."));
  }, []);

  const locate = () => {
    if (!navigator.geolocation || stations.length === 0) return;
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let best: Station | null = null;
        let bestKm = Infinity;
        for (const s of stations) {
          const km = haversineKm(latitude, longitude, s.lat, s.lon);
          if (km < bestKm) {
            bestKm = km;
            best = s;
          }
        }
        setOrigin(best);
        setOriginDistanceKm(bestKm);
        setUserPos({ lat: latitude, lon: longitude });
        setGeoState("ok");
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const search = async () => {
    if (!origin || !destination) return;
    setSearching(true);
    setSearchError(null);
    setJourneys(null);
    try {
      const params = new URLSearchParams({
        feed: origin.feedId,
        from: origin.stopId,
        to: destination.stopId,
      });
      const res = await fetch(`/api/meucomboio/plan?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Erro na consulta.");
      setJourneys(data.journeys);
      setPlanDate(data.date ?? null);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Erro na consulta.");
    } finally {
      setSearching(false);
    }
  };

  const lastSync = feeds.find((f) => f.id === "cp")?.lastSyncAt;

  return (
    <main className="min-h-screen bg-[#080f1a] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 15% 0%, rgba(52,211,153,0.10) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 90% 70%, rgba(56,189,248,0.08) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-xl px-5 pb-16 pt-10 md:pt-16">
        <header className="mb-8 text-center">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Horários oficiais CP
          </p>
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">
            Meu<span className="text-emerald-400">Comboio</span>
            <span className="text-sky-400">PT</span>
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Descobre a estação mais próxima e o próximo comboio para o teu destino.
          </p>
        </header>

        {loadError && (
          <p className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {loadError}
          </p>
        )}

        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <StationPicker
            label="Partida"
            stations={stations}
            selected={origin}
            onSelect={(s) => {
              setOrigin(s);
              setOriginDistanceKm(null);
              setUserPos(null);
              setJourneys(null);
            }}
            placeholder="Escreve o nome da estação…"
            hint={
              originDistanceKm !== null
                ? `Estação mais próxima · a ${originDistanceKm < 1 ? `${Math.round(originDistanceKm * 1000)} m` : `${originDistanceKm.toFixed(1)} km`} de ti`
                : undefined
            }
          />

          {!origin && (
            <button
              onClick={locate}
              disabled={geoState === "asking" || stations.length === 0}
              className="w-full rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-50"
            >
              {geoState === "asking" ? "A localizar…" : "📍 Usar a minha localização"}
            </button>
          )}
          {geoState === "denied" && !origin && (
            <p className="text-xs text-amber-300/80">
              Sem acesso à localização: escolhe a estação de partida manualmente.
            </p>
          )}

          <StationPicker
            label="Destino"
            stations={origin ? stations.filter((s) => s.feedId === origin.feedId && s.stopId !== origin.stopId) : stations}
            selected={destination}
            onSelect={(s) => {
              setDestination(s);
              setJourneys(null);
            }}
            placeholder="Para onde vais?"
          />

          <button
            onClick={search}
            disabled={!origin || !destination || searching}
            className="w-full rounded-xl bg-emerald-500 px-4 py-3.5 font-bold text-[#08221a] transition hover:bg-emerald-400 disabled:opacity-40"
          >
            {searching ? "A consultar…" : "Próximos comboios"}
          </button>
        </section>

        {userPos && origin && (
          <div className="mt-4">
            <AccessDirections
              userPos={userPos}
              station={origin}
              soonestMins={journeys && journeys.length ? minutesUntil(journeys[0].departureSecs) : null}
            />
          </div>
        )}

        {searchError && (
          <p className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {searchError}
          </p>
        )}

        {journeys !== null && (
          <section className="mt-6">
            {journeys.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/60">
                Sem comboios diretos entre estas estações nas próximas horas. Pode ser preciso
                transbordo (ainda não suportado) ou o serviço de hoje já terminou.
              </p>
            ) : (
              <ul className="space-y-3">
                {journeys.map((j, idx) => {
                  const mins = minutesUntil(j.departureSecs);
                  return (
                    <li key={idx}>
                     <button
                      onClick={() => origin && setOpenTrip(j)}
                      className={`w-full rounded-2xl border p-4 text-left transition hover:border-emerald-400/60 ${idx === 0 ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]"}`}
                     >
                      <div className="flex items-baseline justify-between">
                        <p className="text-2xl font-black tabular-nums">
                          {j.departure}
                          <span className="mx-2 text-sm font-normal text-white/40">→</span>
                          {j.arrival}
                        </p>
                        {mins !== null && mins >= 0 && (
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${idx === 0 ? "bg-emerald-400 text-[#08221a]" : "bg-white/10 text-white/70"}`}
                          >
                            {mins === 0 ? "agora" : `em ${mins} min`}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-white/60">
                        {j.route}
                        {j.headsign && ` · sentido ${j.headsign}`}
                      </p>
                      <p className="mt-0.5 text-xs text-white/40">
                        {j.durationMin} min de viagem · {j.stopsBetween} {j.stopsBetween === 1 ? "paragem" : "paragens"} intermédias
                      </p>
                      {j.priceSecond !== null && (
                        <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                          <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm font-bold text-white">
                            {euro(j.priceSecond)}
                          </span>
                          <span className="text-xs text-white/40">2.ª classe</span>
                          {j.priceFirst !== null && (
                            <span className="ml-auto text-xs text-white/40">
                              1.ª {euro(j.priceFirst)}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-300/80">
                        🗺️ Ver percurso no mapa
                      </p>
                     </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-white/30">
          Horários GTFS da CP{lastSync && ` · atualizados a ${new Date(lastSync).toLocaleDateString("pt-PT")}`} ·
          Preços consultados à CP em tempo real (2.ª classe, tarifa base) · Aragón Tecnologia
        </footer>
      </div>

      {openTrip && origin && destination && planDate && (
        <TripMapModal
          feed={origin.feedId}
          from={origin.stopId}
          to={destination.stopId}
          date={planDate}
          dep={openTrip.departure}
          label={`${origin.name} → ${destination.name}`}
          onClose={() => setOpenTrip(null)}
        />
      )}
    </main>
  );
}
