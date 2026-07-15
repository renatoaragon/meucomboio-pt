// MeuComboioPT: detail of a single train: the ordered list of stops (with GPS
// and times) used to draw the route on the map and estimate the position.

import { searchJourneys, type OutwardTrip } from "./cp-api";

export type TripStop = {
  name: string;
  lat: number;
  lon: number;
  arrival: string | null; // "HH:MM" (null at the origin)
  departure: string | null; // "HH:MM" (null at the destination)
};

export type TripDetail = {
  service: string; // "AP" | "IC" | "IR" | ...
  serviceName: string;
  trainNumber: number | null;
  departure: string;
  arrival: string;
  delayMin: number | null;
  stops: TripStop[];
};

function flattenStops(trip: OutwardTrip): TripStop[] {
  const stops: TripStop[] = [];
  for (const section of trip.travelSections ?? []) {
    for (const s of section.trainStops ?? []) {
      const lat = Number(s.latitude);
      const lon = Number(s.longitude);
      if (!s.station?.designation || Number.isNaN(lat) || Number.isNaN(lon)) continue;
      // Avoid duplicating the transfer station (end of one section = start of
      // the next) when the coordinates match.
      const last = stops[stops.length - 1];
      if (last && last.lat === lat && last.lon === lon) continue;
      stops.push({
        name: s.station.designation,
        lat,
        lon,
        arrival: s.arrival ? s.arrival.slice(0, 5) : null,
        departure: s.departure ? s.departure.slice(0, 5) : null,
      });
    }
  }
  // The origin has no arrival; the destination has no departure.
  if (stops.length) {
    stops[0].arrival = null;
    stops[stops.length - 1].departure = null;
  }
  return stops;
}

export async function fetchTripDetail(
  fromStopId: string,
  toStopId: string,
  dateIso: string,
  departureHHMM: string
): Promise<TripDetail | null> {
  const trips = await searchJourneys(fromStopId, toStopId, dateIso);
  const trip = trips.find((t) => (t.departureTime ?? "").slice(0, 5) === departureHHMM);
  if (!trip) return null;

  const stops = flattenStops(trip);
  if (stops.length < 2) return null;

  const section = trip.travelSections?.[0];
  const delayRaw = trip.delay ?? section?.trainStops?.find((s) => s.delay)?.delay ?? null;
  const delayMin = delayRaw != null && delayRaw !== "" ? Number(delayRaw) : null;

  return {
    service: trip.services || section?.serviceCode?.code || "Comboio",
    serviceName: section?.serviceCode?.designation || trip.services || "Comboio",
    trainNumber: section?.trainNumber ?? null,
    departure: (trip.departureTime ?? "").slice(0, 5),
    arrival: (trip.arrivalTime ?? "").slice(0, 5),
    delayMin: Number.isFinite(delayMin as number) ? (delayMin as number) : null,
    stops,
  };
}
