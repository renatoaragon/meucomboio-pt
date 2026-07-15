// GET /api/meucomboio/stations: lista completa de estações (id, nome, GPS).
// O cliente usa esta lista para autocomplete e para achar a estação mais
// próxima; cache de 1h porque só muda quando o GTFS é ressincronizado.

import { NextResponse } from "next/server";
import { listStations, feedStatus } from "@/lib/meucomboio/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [stations, feeds] = await Promise.all([listStations(), feedStatus()]);
    return NextResponse.json(
      { stations, feeds },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (err) {
    console.error("[meucomboio] stations failed:", err);
    return NextResponse.json({ message: "Base de horários indisponível." }, { status: 500 });
  }
}
