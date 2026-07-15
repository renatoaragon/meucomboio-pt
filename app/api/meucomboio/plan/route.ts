// GET /api/meucomboio/plan?feed=cp&from=<stopId>&to=<stopId>
// Próximos comboios diretos entre duas estações, com hora de chegada.

import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { planJourneys } from "@/lib/meucomboio/repo";
import { lisbonNow } from "@/lib/meucomboio/gtfs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (!checkRateLimit("meucomboio_plan", ip, 30, 60 * 1000)) {
    return NextResponse.json({ message: "Muitas consultas. Tenta novamente num instante." }, { status: 429 });
  }

  const url = new URL(req.url);
  const feed = url.searchParams.get("feed") ?? "cp";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || from === to) {
    return NextResponse.json({ message: "Parâmetros 'from' e 'to' obrigatórios e distintos." }, { status: 400 });
  }

  try {
    const journeys = await planJourneys(feed, from, to);
    const { dateInt } = lisbonNow();
    const date = `${Math.floor(dateInt / 10000)}-${String(Math.floor((dateInt % 10000) / 100)).padStart(2, "0")}-${String(dateInt % 100).padStart(2, "0")}`;
    return NextResponse.json({ journeys, date });
  } catch (err) {
    console.error("[meucomboio] plan failed:", err);
    return NextResponse.json({ message: "Não foi possível planear a viagem." }, { status: 500 });
  }
}
