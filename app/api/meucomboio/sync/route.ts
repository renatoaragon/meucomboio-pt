// POST /api/meucomboio/sync: downloads the operators' GTFS feeds and reloads
// the database. Authenticated by a static token (meant for a daily cron).
//
// Suggested cron (CP refreshes its GTFS daily):
//   0 4 * * * curl -s -X POST -H "x-sync-token: $MEUCOMBOIO_SYNC_TOKEN" \
//     http://127.0.0.1:3000/api/meucomboio/sync

import { NextResponse } from "next/server";
import { recentSyncRuns, syncAllFeeds } from "@/lib/meucomboio/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const expected = process.env.MEUCOMBOIO_SYNC_TOKEN;
  const token = req.headers.get("x-sync-token");

  if (!expected || token !== expected) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const results = await syncAllFeeds();
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ results }, { status: ok ? 200 : 502 });
}

// GET: recent ingestion runs with counts, warnings and duration. Public and
// read-only: it is the pipeline's health page.
export async function GET() {
  const runs = await recentSyncRuns(20);
  return NextResponse.json({ runs });
}
