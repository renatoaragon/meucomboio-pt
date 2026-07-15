// GET /api/meucomboio/trip?feed=cp&from=<stopId>&to=<stopId>&date=YYYY-MM-DD&dep=HH:MM
// Stops (with GPS and times) of a specific train, for the route map.

import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchTripDetail } from "@/lib/meucomboio/cp-trip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (!checkRateLimit("meucomboio_trip", ip, 30, 60 * 1000)) {
    return NextResponse.json({ message: "Muitas consultas. Tenta novamente num instante." }, { status: 429 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const date = url.searchParams.get("date");
  const dep = url.searchParams.get("dep");
  if (!from || !to || !date || !dep) {
    return NextResponse.json({ message: "Parâmetros 'from', 'to', 'date' e 'dep' obrigatórios." }, { status: 400 });
  }

  try {
    const trip = await fetchTripDetail(from, to, date, dep);
    if (!trip) {
      return NextResponse.json({ message: "Trajeto indisponível para este comboio." }, { status: 404 });
    }
    return NextResponse.json({ trip });
  } catch (err) {
    console.error("[meucomboio] trip failed:", err);
    return NextResponse.json({ message: "Não foi possível obter o trajeto." }, { status: 502 });
  }
}
