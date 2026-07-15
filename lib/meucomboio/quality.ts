// Data quality gate for GTFS ingestion.
//
// Runs BEFORE the load transaction: a feed that fails any "error" check is
// rejected and the database keeps serving the previous snapshot. Warnings are
// recorded in the sync run report but do not block the load.
//
// All checks are pure functions over parsed rows, so they are unit-testable
// without a database.

export type QualityIssue = {
  check: string;
  severity: "error" | "warning";
  detail: string;
};

export type FeedShape = {
  stops: { id: string }[];
  routes: { id: string }[];
  trips: { id: string; routeId: string; serviceId: string }[];
  stopTimes: { tripId: string; stopId: string }[];
  calendar: { serviceId: string; endDate: number }[];
  calendarDates: { serviceId: string; date: number }[];
};

export type PreviousCounts = {
  stops: number;
  trips: number;
  stopTimes: number;
} | null;

// Reference feeds routinely ship a handful of orphan rows; small ratios are
// noise, large ratios mean the zip is truncated or the export is broken.
const ORPHAN_WARN_RATIO = 0.001; // 0.1%
const ORPHAN_ERROR_RATIO = 0.01; // 1%

// A big drop against the previous snapshot usually means a bad download, not
// a real timetable change. Losing half the network is never a normal update.
const DRIFT_WARN_DROP = 0.2; // -20%
const DRIFT_ERROR_DROP = 0.5; // -50%

function ratioIssue(
  check: string,
  orphans: number,
  total: number,
  detail: string,
): QualityIssue | null {
  if (total === 0 || orphans === 0) return null;
  const ratio = orphans / total;
  if (ratio >= ORPHAN_ERROR_RATIO) {
    return { check, severity: "error", detail: `${detail}: ${orphans}/${total} (${(ratio * 100).toFixed(2)}%)` };
  }
  return { check, severity: "warning", detail: `${detail}: ${orphans}/${total} (${(ratio * 100).toFixed(2)}%)` };
}

function driftIssue(check: string, previous: number, current: number): QualityIssue | null {
  if (previous <= 0) return null;
  const drop = (previous - current) / previous;
  if (drop >= DRIFT_ERROR_DROP) {
    return { check, severity: "error", detail: `dropped from ${previous} to ${current} (${(drop * 100).toFixed(0)}%)` };
  }
  if (drop >= DRIFT_WARN_DROP) {
    return { check, severity: "warning", detail: `dropped from ${previous} to ${current} (${(drop * 100).toFixed(0)}%)` };
  }
  return null;
}

export function checkFeedQuality(
  feed: FeedShape,
  todayInt: number,
  previous: PreviousCounts,
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // 1. Required files must not be empty.
  for (const [name, rows] of [
    ["stops", feed.stops],
    ["routes", feed.routes],
    ["trips", feed.trips],
    ["stop_times", feed.stopTimes],
  ] as const) {
    if (rows.length === 0) {
      issues.push({ check: "required_file", severity: "error", detail: `${name} is empty` });
    }
  }

  // 2. Service definitions must exist somewhere.
  if (feed.calendar.length === 0 && feed.calendarDates.length === 0) {
    issues.push({
      check: "service_definitions",
      severity: "error",
      detail: "both calendar and calendar_dates are empty; no trip would ever run",
    });
  }

  // 3. Referential integrity.
  const routeIds = new Set(feed.routes.map((r) => r.id));
  const serviceIds = new Set([
    ...feed.calendar.map((c) => c.serviceId),
    ...feed.calendarDates.map((c) => c.serviceId),
  ]);
  const tripIds = new Set(feed.trips.map((t) => t.id));
  const stopIds = new Set(feed.stops.map((s) => s.id));

  const tripsUnknownRoute = feed.trips.filter((t) => !routeIds.has(t.routeId)).length;
  const tripsUnknownService = feed.trips.filter((t) => !serviceIds.has(t.serviceId)).length;
  const stUnknownTrip = feed.stopTimes.filter((st) => !tripIds.has(st.tripId)).length;
  const stUnknownStop = feed.stopTimes.filter((st) => !stopIds.has(st.stopId)).length;

  for (const issue of [
    ratioIssue("trips_route_fk", tripsUnknownRoute, feed.trips.length, "trips referencing unknown route"),
    ratioIssue("trips_service_fk", tripsUnknownService, feed.trips.length, "trips referencing unknown service"),
    ratioIssue("stop_times_trip_fk", stUnknownTrip, feed.stopTimes.length, "stop_times referencing unknown trip"),
    ratioIssue("stop_times_stop_fk", stUnknownStop, feed.stopTimes.length, "stop_times referencing unknown stop"),
  ]) {
    if (issue) issues.push(issue);
  }

  // 4. Staleness: a feed whose whole calendar is in the past serves nothing.
  const lastServiceDay = Math.max(
    0,
    ...feed.calendar.map((c) => c.endDate),
    ...feed.calendarDates.map((c) => c.date),
  );
  if (lastServiceDay > 0) {
    if (lastServiceDay < todayInt) {
      issues.push({
        check: "feed_expired",
        severity: "error",
        detail: `last service day ${lastServiceDay} is before today ${todayInt}`,
      });
    } else if (lastServiceDay < addDays(todayInt, 7)) {
      issues.push({
        check: "feed_expiring",
        severity: "warning",
        detail: `last service day ${lastServiceDay} is less than 7 days away`,
      });
    }
  }

  // 5. Drift against the previous successful load.
  if (previous) {
    for (const issue of [
      driftIssue("drift_stops", previous.stops, feed.stops.length),
      driftIssue("drift_trips", previous.trips, feed.trips.length),
      driftIssue("drift_stop_times", previous.stopTimes, feed.stopTimes.length),
    ]) {
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

export function hasErrors(issues: QualityIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export function summarize(issues: QualityIssue[]): string {
  return issues.map((i) => `[${i.severity}] ${i.check}: ${i.detail}`).join("; ");
}

/** Adds N days to a yyyymmdd integer. */
export function addDays(dateInt: number, days: number): number {
  const y = Math.floor(dateInt / 10000);
  const m = Math.floor((dateInt % 10000) / 100) - 1;
  const d = dateInt % 100;
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}
