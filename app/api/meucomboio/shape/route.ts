// POST /api/meucomboio/shape  { from, to, stops: [{lat,lon}, ...] }
// Returns the route polyline over the rails (OSM). Progressive enhancement:
// the map draws the straight line first and swaps it for this once it arrives.

import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchRailShape } from "@/lib/meucomboio/rail-geometry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!checkRateLimit("meucomboio_shape", ip, 20, 60 * 1000)) {
    return NextResponse.json({ message: "Muitas consultas." }, { status: 429 });
  }

  let body: { from?: string; to?: string; stops?: { lat: number; lon: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Requisição inválida." }, { status: 400 });
  }

  const { from, to, stops } = body;
  if (!from || !to || !Array.isArray(stops) || stops.length < 2) {
    return NextResponse.json({ message: "Parâmetros inválidos." }, { status: 400 });
  }
  const clean = stops
    .map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (clean.length < 2) {
    return NextResponse.json({ message: "Coordenadas inválidas." }, { status: 400 });
  }

  try {
    const shape = await fetchRailShape(`${from}|${to}`, clean);
    return NextResponse.json({ shape });
  } catch (err) {
    console.error("[meucomboio] shape failed:", err);
    return NextResponse.json({ shape: clean.map((s) => [s.lon, s.lat]) });
  }
}
