// GET /api/meucomboio/stations: full station list (id, name, GPS).
// The client uses this list for autocomplete and to find the nearest station;
// cached for 1h because it only changes when the GTFS feed is resynced.

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
