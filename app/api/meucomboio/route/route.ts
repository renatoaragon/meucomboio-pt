// GET /api/meucomboio/route?fLat=&fLon=&tLat=&tLon=&mode=foot|bike|car
// Tempo, distância e direções do utilizador até à estação, por modo.

import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchDirections, type TravelMode } from "@/lib/meucomboio/directions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES: TravelMode[] = ["foot", "bike", "car"];

export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (!checkRateLimit("meucomboio_route", ip, 40, 60 * 1000)) {
    return NextResponse.json({ message: "Muitas consultas." }, { status: 429 });
  }

  const u = new URL(req.url);
  const fLat = Number(u.searchParams.get("fLat"));
  const fLon = Number(u.searchParams.get("fLon"));
  const tLat = Number(u.searchParams.get("tLat"));
  const tLon = Number(u.searchParams.get("tLon"));
  const mode = u.searchParams.get("mode") as TravelMode;

  if (![fLat, fLon, tLat, tLon].every(Number.isFinite) || !MODES.includes(mode)) {
    return NextResponse.json({ message: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    const directions = await fetchDirections({ lat: fLat, lon: fLon }, { lat: tLat, lon: tLon }, mode);
    return NextResponse.json({ directions });
  } catch (err) {
    console.error("[meucomboio] route failed:", err);
    return NextResponse.json({ message: "Não foi possível calcular a rota." }, { status: 502 });
  }
}
