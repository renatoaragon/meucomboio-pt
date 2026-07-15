import { describe, expect, it } from "vitest";

import { addDays, checkFeedQuality, hasErrors, summarize, type FeedShape } from "@/lib/meucomboio/quality";

const TODAY = 20260715;

/** A minimal internally-consistent feed the checks should accept. */
function healthyFeed(overrides: Partial<FeedShape> = {}): FeedShape {
  const stops = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}` }));
  const routes = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
  const trips = Array.from({ length: 200 }, (_, i) => ({
    id: `t${i}`,
    routeId: `r${i % 10}`,
    serviceId: "weekdays",
  }));
  const stopTimes = trips.flatMap((t, i) => [
    { tripId: t.id, stopId: `s${i % 100}`, },
    { tripId: t.id, stopId: `s${(i + 1) % 100}` },
  ]);
  const calendar = [{ serviceId: "weekdays", endDate: addDays(TODAY, 60) }];
  return { stops, routes, trips, stopTimes, calendar, calendarDates: [], ...overrides };
}

describe("checkFeedQuality", () => {
  it("accepts a healthy feed with no issues", () => {
    expect(checkFeedQuality(healthyFeed(), TODAY, null)).toEqual([]);
  });

  it("rejects empty required files", () => {
    const issues = checkFeedQuality(healthyFeed({ stops: [] }), TODAY, null);
    expect(issues.some((i) => i.check === "required_file" && i.severity === "error")).toBe(true);
  });

  it("rejects a feed with no service definitions at all", () => {
    const issues = checkFeedQuality(healthyFeed({ calendar: [], calendarDates: [] }), TODAY, null);
    expect(issues.some((i) => i.check === "service_definitions" && i.severity === "error")).toBe(true);
  });

  it("warns on a small ratio of orphan references", () => {
    const feed = healthyFeed();
    feed.trips[0] = { ...feed.trips[0], routeId: "missing" }; // 1/200 = 0.5%
    const issues = checkFeedQuality(feed, TODAY, null);
    const issue = issues.find((i) => i.check === "trips_route_fk");
    expect(issue?.severity).toBe("warning");
  });

  it("errors on a large ratio of orphan references", () => {
    const feed = healthyFeed();
    feed.stopTimes = feed.stopTimes.map((st, i) =>
      i % 10 === 0 ? { ...st, tripId: "ghost" } : st, // 10%
    );
    const issues = checkFeedQuality(feed, TODAY, null);
    const issue = issues.find((i) => i.check === "stop_times_trip_fk");
    expect(issue?.severity).toBe("error");
  });

  it("errors when the whole calendar is in the past", () => {
    const feed = healthyFeed({ calendar: [{ serviceId: "weekdays", endDate: addDays(TODAY, -1) }] });
    // Keep trips pointing at a service that exists so only staleness fires.
    const issues = checkFeedQuality(feed, TODAY, null);
    expect(issues.some((i) => i.check === "feed_expired" && i.severity === "error")).toBe(true);
  });

  it("warns when the calendar expires within a week", () => {
    const feed = healthyFeed({ calendar: [{ serviceId: "weekdays", endDate: addDays(TODAY, 3) }] });
    const issues = checkFeedQuality(feed, TODAY, null);
    expect(issues.some((i) => i.check === "feed_expiring" && i.severity === "warning")).toBe(true);
  });

  it("flags drift against the previous load: warning at -30%, error at -60%", () => {
    const feed = healthyFeed();
    const warn = checkFeedQuality(feed, TODAY, {
      stops: Math.round(feed.stops.length / 0.7),
      trips: feed.trips.length,
      stopTimes: feed.stopTimes.length,
    });
    expect(warn.find((i) => i.check === "drift_stops")?.severity).toBe("warning");

    const error = checkFeedQuality(feed, TODAY, {
      stops: Math.round(feed.stops.length / 0.4),
      trips: feed.trips.length,
      stopTimes: feed.stopTimes.length,
    });
    expect(error.find((i) => i.check === "drift_stops")?.severity).toBe("error");
  });

  it("ignores drift when there is no previous load", () => {
    expect(checkFeedQuality(healthyFeed(), TODAY, null)).toEqual([]);
  });
});

describe("helpers", () => {
  it("hasErrors and summarize behave", () => {
    const issues = [
      { check: "a", severity: "warning" as const, detail: "x" },
      { check: "b", severity: "error" as const, detail: "y" },
    ];
    expect(hasErrors(issues)).toBe(true);
    expect(summarize(issues)).toContain("[error] b: y");
  });

  it("addDays rolls over months and years", () => {
    expect(addDays(20261230, 5)).toBe(20270104);
    expect(addDays(20260228, 1)).toBe(20260301);
  });
});
