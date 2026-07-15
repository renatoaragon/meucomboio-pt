# MeuComboioPT

**"Which train can I still catch?"** Real-time next departures and trip planning
for Portugal, built on top of the open GTFS data published by CP (Comboios de
Portugal).

Open the app, allow location access, and it answers the one question that
matters on the way to the station: *can I make it?* It finds the nearest
station, estimates your travel time to it (walking or driving), and tells you
whether the next train is comfortably catchable, tight, or already lost.

> The user interface is in Portuguese: the product is built for people riding
> trains in Portugal.

## Features

- Nearest-station detection from browser geolocation
- Next departures per station with service-calendar awareness (weekday,
  holiday and exception handling straight from GTFS `calendar` and
  `calendar_dates`)
- "Can I make it?" verdict comparing your door-to-station time against the
  next departures
- Trip planning between any two stations, with per-train pricing fetched from
  CP's public travel API
- Live trip view: the train position estimated from the timetable (clearly
  labeled as an estimate, not on-board GPS) drawn over the real rail geometry
- Zero heavy front-end dependencies: the map is hand-rolled SVG

## Architecture

```
GTFS zip (CP, daily)          OpenRouteService (optional)
       |                                 |
       v                                 v
POST /api/meucomboio/sync         directions.ts
       |                                 |
  gtfs.ts (parse/validate)               |
       v                                 v
   PostgreSQL  <----  repo.ts  ---->  Next.js app (React 19)
   7 raw SQL tables   (planning &     nearest station, departures,
   (scripts/init.sql)  departures)    trip planner, SVG live map
```

- **Ingestion**: `POST /api/meucomboio/sync` (token-authenticated, cron-driven)
  downloads each operator's GTFS zip, parses it with a dependency-free CSV
  parser and reloads the tables idempotently.
- **Storage**: plain PostgreSQL, schema in [scripts/init.sql](scripts/init.sql).
  Prisma is used only as a typed SQL executor (`$queryRaw`), no ORM models.
- **Planning**: pure SQL + a small amount of TypeScript over `stop_times`,
  `trips`, `calendar` and `calendar_dates`.

## Getting started

```bash
npm install
cp .env.example .env   # fill DATABASE_URL and MEUCOMBOIO_SYNC_TOKEN
npm run db:init        # creates the GTFS tables
npm run dev
```

Load the data once (and then daily via cron):

```bash
curl -X POST -H "x-sync-token: $MEUCOMBOIO_SYNC_TOKEN" \
  http://localhost:3000/api/meucomboio/sync
```

## Data source

- [CP GTFS feed](https://publico.cp.pt/gtfs/gtfs.zip), refreshed daily by the
  operator. This project is not affiliated with CP - Comboios de Portugal.

## Roadmap

- Data quality checks on every sync (referential integrity, row-count drift)
  with a persisted sync-run report
- Scheduled sync via GitHub Actions in addition to server cron
- Analytics layer (dbt + DuckDB): departures per station/line, service
  coverage, timetable evolution over time
- Unit tests for the GTFS parser and the trip planner

## License

MIT
