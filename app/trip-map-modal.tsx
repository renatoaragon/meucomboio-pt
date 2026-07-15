"use client";

// Modal com o mapa do trajeto de um comboio: linha do percurso, pin em cada
// estação, destaque para origem e destino, e um marcador da posição estimada
// (interpolada pelo horário + atraso real quando a CP o publica).
// Não é GPS a bordo, é uma estimativa baseada no horário; indicado no ecrã.

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

type TripStop = {
  name: string;
  lat: number;
  lon: number;
  arrival: string | null;
  departure: string | null;
};
type TripDetail = {
  service: string;
  serviceName: string;
  trainNumber: number | null;
  departure: string;
  arrival: string;
  delayMin: number | null;
  stops: TripStop[];
};

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

const hhmmToSec = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 3600 + m * 60;
};

function lisbonNowSec() {
  const s = new Date().toLocaleString("en-GB", { timeZone: "Europe/Lisbon", hour12: false });
  const m = /(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Timeline absoluta (segundos, monotónica) para lidar com travessia da meia-noite.
function buildTimeline(stops: TripStop[]) {
  let base = 0;
  let prev = -Infinity;
  const norm = (t: string) => {
    let s = hhmmToSec(t);
    while (s + base < prev) base += 86400;
    s += base;
    prev = s;
    return s;
  };
  const arr: (number | null)[] = [];
  const dep: (number | null)[] = [];
  stops.forEach((st, i) => {
    arr[i] = st.arrival ? norm(st.arrival) : null;
    dep[i] = st.departure ? norm(st.departure) : null;
  });
  return { arr, dep };
}

type Position =
  | { state: "before" }
  | { state: "arrived" }
  | { state: "running"; lat: number; lon: number; nextIndex: number };

function estimatePosition(stops: TripStop[], delayMin: number | null): Position {
  const { arr, dep } = buildTimeline(stops);
  const firstDep = dep[0] ?? arr[0] ?? 0;
  const lastArr = arr[stops.length - 1] ?? dep[stops.length - 1] ?? firstDep;

  let now = lisbonNowSec();
  if (lastArr > 86400 && now < 4 * 3600) now += 86400; // check de madrugada
  const sched = now - (delayMin ?? 0) * 60;

  if (sched <= firstDep) return { state: "before" };
  if (sched >= lastArr) return { state: "arrived" };

  for (let i = 0; i < stops.length - 1; i++) {
    const d = dep[i] ?? arr[i];
    const a = arr[i + 1] ?? dep[i + 1];
    if (d == null || a == null) continue;
    // Parado na estação i (dwell).
    if (arr[i] != null && dep[i] != null && sched >= (arr[i] as number) && sched < (dep[i] as number)) {
      return { state: "running", lat: stops[i].lat, lon: stops[i].lon, nextIndex: i };
    }
    // A viajar entre i e i+1.
    if (sched >= d && sched < a) {
      const f = a > d ? (sched - d) / (a - d) : 0;
      return {
        state: "running",
        lat: stops[i].lat + (stops[i + 1].lat - stops[i].lat) * f,
        lon: stops[i].lon + (stops[i + 1].lon - stops[i].lon) * f,
        nextIndex: i + 1,
      };
    }
  }
  return { state: "before" };
}

export function TripMapModal({
  feed,
  from,
  to,
  date,
  dep,
  label,
  onClose,
}: {
  feed: string;
  from: string;
  to: string;
  date: string;
  dep: string;
  label: string;
  onClose: () => void;
}) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState<Position | null>(null);

  const mapNode = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trainMarker = useRef<any>(null);

  // Carrega o trajeto.
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ feed, from, to, date, dep });
    fetch(`/api/meucomboio/trip?${params}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message ?? "Erro.");
        return data.trip as TripDetail;
      })
      .then((t) => {
        if (alive) {
          setTrip(t);
          setPos(estimatePosition(t.stops, t.delayMin));
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Erro."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [feed, from, to, date, dep]);

  // Recalcula a posição estimada a cada 10s.
  useEffect(() => {
    if (!trip) return;
    const id = setInterval(() => setPos(estimatePosition(trip.stops, trip.delayMin)), 10000);
    return () => clearInterval(id);
  }, [trip]);

  // Inicializa o mapa quando o trajeto chega.
  useEffect(() => {
    if (!trip || !mapNode.current) return;
    let cleanup = () => {};
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      const coords = trip.stops.map((s) => [s.lon, s.lat] as [number, number]);

      const map = new maplibre.Map({
        container: mapNode.current!,
        style: OSM_STYLE,
        bounds: [
          [Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1]))],
          [Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1]))],
        ],
        fitBoundsOptions: { padding: 48 },
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on("load", () => {
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#34d399", "line-width": 4, "line-opacity": 0.9 },
        });

        // Melhoria progressiva: substitui a reta pela geometria sobre os trilhos.
        fetch("/api/meucomboio/shape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to,
            stops: trip.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const src = map.getSource("route") as any;
            if (d?.shape?.length > 1 && src?.setData) {
              src.setData({ type: "Feature", geometry: { type: "LineString", coordinates: d.shape }, properties: {} });
            }
          })
          .catch(() => {});

        // Pin em cada estação (origem = verde, destino = âmbar/maior, resto = ponto).
        trip.stops.forEach((s, i) => {
          const isOrigin = i === 0;
          const isDest = i === trip.stops.length - 1;
          const el = document.createElement("div");
          el.style.cssText = `width:${isDest ? 18 : isOrigin ? 14 : 9}px;height:${
            isDest ? 18 : isOrigin ? 14 : 9
          }px;border-radius:50%;border:2px solid #08221a;box-shadow:0 0 0 1px rgba(255,255,255,.4);background:${
            isDest ? "#fbbf24" : isOrigin ? "#34d399" : "#94a3b8"
          };`;
          new maplibre.Marker({ element: el })
            .setLngLat([s.lon, s.lat])
            .setPopup(
              new maplibre.Popup({ offset: 12, closeButton: false }).setText(
                `${s.name}${isDest ? " (destino)" : isOrigin ? " (partida)" : ""}`
              )
            )
            .addTo(map);
        });

        // Marcador do comboio (posição estimada).
        const t = document.createElement("div");
        t.textContent = "🚆";
        t.style.cssText = "font-size:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));transition:all .8s linear;";
        trainMarker.current = new maplibre.Marker({ element: t });
      });

      cleanup = () => map.remove();
    })();
    return () => cleanup();
  }, [trip, from, to]);

  // Atualiza o marcador do comboio conforme a posição estimada.
  useEffect(() => {
    const map = mapRef.current;
    const marker = trainMarker.current;
    if (!map || !marker || !pos) return;
    if (pos.state === "running") {
      marker.setLngLat([pos.lon, pos.lat]).addTo(map);
    } else {
      marker.remove();
    }
  }, [pos]);

  // "Faltam N paragens até ao destino".
  const destIndex = trip ? trip.stops.length - 1 : 0;
  const nextIndex = pos && pos.state === "running" ? pos.nextIndex : null;
  const stopsToDest = nextIndex != null ? destIndex - nextIndex : null;

  const statusLine = (() => {
    if (!pos || !trip) return "";
    if (pos.state === "before")
      return trip.delayMin ? `Ainda não partiu · atraso de ${trip.delayMin} min` : "Ainda não partiu";
    if (pos.state === "arrived") return "Viagem terminada";
    const next = trip.stops[nextIndex as number];
    const remaining =
      stopsToDest === 0
        ? `a chegar ao destino`
        : `faltam ${stopsToDest} ${stopsToDest === 1 ? "paragem" : "paragens"} até ${trip.stops[destIndex].name}`;
    const delayTxt = trip.delayMin ? ` · atraso ${trip.delayMin} min` : "";
    return `Próxima paragem: ${next.name} · ${remaining}${delayTxt}`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-[#0b1420] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <p className="font-black text-white">{label}</p>
            {trip && (
              <p className="text-xs text-white/50">
                {trip.serviceName}
                {trip.trainNumber ? ` ${trip.trainNumber}` : ""} · {trip.departure} → {trip.arrival}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            Fechar
          </button>
        </header>

        {loading && <div className="px-5 py-10 text-center text-sm text-white/50">A carregar o trajeto…</div>}
        {error && <div className="px-5 py-10 text-center text-sm text-red-300">{error}</div>}

        {trip && (
          <>
            <div ref={mapNode} className="h-64 w-full shrink-0 bg-[#0b1420] sm:h-72" />

            {statusLine && (
              <div className="border-b border-white/10 bg-emerald-400/10 px-5 py-3 text-sm font-semibold text-emerald-200">
                {statusLine}
              </div>
            )}

            <ol className="min-h-0 flex-1 overflow-auto px-5 py-3">
              {trip.stops.map((s, i) => {
                const isOrigin = i === 0;
                const isDest = i === destIndex;
                const isNext = i === nextIndex;
                return (
                  <li key={i} className="flex items-center gap-3 py-1.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border-2 border-[#0b1420]"
                      style={{
                        background: isDest ? "#fbbf24" : isOrigin ? "#34d399" : "#475569",
                        boxShadow: isNext ? "0 0 0 3px rgba(52,211,153,.5)" : undefined,
                      }}
                    />
                    <span className={`flex-1 text-sm ${isDest || isOrigin ? "font-bold text-white" : "text-white/70"}`}>
                      {s.name}
                      {isDest && <span className="ml-2 text-xs font-normal text-amber-300">destino</span>}
                    </span>
                    <span className="text-xs tabular-nums text-white/40">{s.arrival ?? s.departure ?? ""}</span>
                  </li>
                );
              })}
            </ol>

            <p className="border-t border-white/10 px-5 py-2.5 text-[11px] leading-snug text-white/30">
              Posição estimada pelo horário{trip.delayMin ? " e atraso oficial" : ""}; não é GPS a bordo do comboio.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
