import { describe, expect, it } from "vitest";

import { distanceKm, parseCsv, previousDate, secsToHHMM, timeToSecs } from "@/lib/meucomboio/gtfs";

describe("parseCsv", () => {
  it("parses a plain file into objects keyed by header", () => {
    const rows = parseCsv("stop_id,stop_name\n1,Lisboa\n2,Porto\n");
    expect(rows).toEqual([
      { stop_id: "1", stop_name: "Lisboa" },
      { stop_id: "2", stop_name: "Porto" },
    ]);
  });

  it("handles quoted fields with commas and doubled quotes (RFC 4180)", () => {
    const rows = parseCsv('id,name\n1,"Estação, Central"\n2,"Diz ""olá"""\n');
    expect(rows[0].name).toBe("Estação, Central");
    expect(rows[1].name).toBe('Diz "olá"');
  });

  it("handles quoted line breaks inside a field", () => {
    const rows = parseCsv('id,notes\n1,"linha 1\nlinha 2"\n');
    expect(rows[0].notes).toBe("linha 1\nlinha 2");
  });

  it("strips the BOM and accepts CRLF line endings", () => {
    const rows = parseCsv("﻿id,name\r\n1,Aveiro\r\n");
    expect(rows).toEqual([{ id: "1", name: "Aveiro" }]);
  });

  it("fills missing trailing columns with empty strings", () => {
    const rows = parseCsv("a,b,c\n1,2\n");
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("timeToSecs", () => {
  it("converts HH:MM:SS", () => {
    expect(timeToSecs("08:30:00")).toBe(8 * 3600 + 30 * 60);
  });

  it("accepts GTFS times past 24h (previous service day)", () => {
    expect(timeToSecs("25:10:00")).toBe(25 * 3600 + 10 * 60);
  });

  it("accepts single-digit hours", () => {
    expect(timeToSecs("7:05:00")).toBe(7 * 3600 + 5 * 60);
  });

  it("rejects malformed values", () => {
    expect(timeToSecs("8h30")).toBeNull();
    expect(timeToSecs("")).toBeNull();
    expect(timeToSecs("08:30")).toBeNull();
  });
});

describe("secsToHHMM", () => {
  it("formats and wraps past-midnight times into the civil day", () => {
    expect(secsToHHMM(8 * 3600 + 30 * 60)).toBe("08:30");
    expect(secsToHHMM(25 * 3600 + 10 * 60)).toBe("01:10");
  });
});

describe("previousDate", () => {
  it("handles month and year rollovers", () => {
    expect(previousDate(20260101)).toBe(20251231);
    expect(previousDate(20260301)).toBe(20260228);
    expect(previousDate(20240301)).toBe(20240229); // leap year
  });
});

describe("distanceKm", () => {
  it("is roughly right for Lisboa to Porto", () => {
    const d = distanceKm(38.7139, -9.1225, 41.1496, -8.5855);
    expect(d).toBeGreaterThan(260);
    expect(d).toBeLessThan(290);
  });

  it("is zero for the same point", () => {
    expect(distanceKm(38.7, -9.1, 38.7, -9.1)).toBeCloseTo(0, 6);
  });
});
