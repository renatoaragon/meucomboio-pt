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
  parser and swaps the snapshot inside a single transaction.
- **Data quality gate**: every feed is validated BEFORE it touches the
  database: required files, referential integrity, calendar staleness and
  volume drift against the previous load. A bad snapshot is rejected and the
  app keeps serving the previous one. See
  [lib/meucomboio/quality.ts](lib/meucomboio/quality.ts).
- **Observability**: every ingestion attempt is recorded in
  `meucomboio_sync_runs` (counts, warnings, duration, failure reason);
  `GET /api/meucomboio/sync` exposes the recent runs as a health page.
- **Storage**: plain PostgreSQL, schema in [scripts/init.sql](scripts/init.sql).
  Prisma is used only as a typed SQL executor (`$queryRaw`), no ORM models.
- **Planning**: pure SQL + a small amount of TypeScript over `stop_times`,
  `trips`, `calendar` and `calendar_dates`.
- **Analytics**: a dbt + DuckDB layer attaches Postgres read-only and builds
  marts for service offer per station, route service span and pipeline
  health. See [analytics/](analytics/).

## Design principles

MeuComboioPT is a real product with real users, but the data engineering inside it
holds to the same discipline as my portfolio work, not a lower bar because it ships.
Tools are the disposable part: the GTFS parser, Postgres and the dbt layer could be
swapped without changing what the pipeline guarantees. What lasts is the shape.

- **A quality gate stands in front of production.** Every GTFS feed is validated
  before it touches the database (required files, referential integrity, calendar
  staleness, volume drift against the last load). A bad snapshot is rejected and the
  app keeps serving the previous one, so a broken upstream never becomes a broken
  product. It is the same gate idea as
  [spark-retail-etl](https://github.com/renatoaragon/spark-retail-etl), guarding a
  live feed instead of a batch.
- **The swap is atomic.** A new snapshot replaces the old inside a single
  transaction, so the app never reads a half-loaded feed.
- **Every ingestion is observable.** Each run records counts, warnings, duration and
  failure reason, exposed as a health endpoint. A pipeline you cannot see is one you
  cannot trust.
- **Analytics sits beside the app, read-only.** A dbt + DuckDB layer attaches
  Postgres read-only and builds marts without adding load or risk to the serving path.

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

## Testing

```bash
npm run typecheck
npm test          # vitest: GTFS parser + data quality gate
```

CI runs typecheck, tests and a production build on every push. A scheduled
workflow ([.github/workflows/sync.yml](.github/workflows/sync.yml)) can
trigger the daily feed reload against your deployment.

## Roadmap

- Additional operators (Fertagus) once a stable public GTFS zip is confirmed
- Real-time delay feed integration when CP exposes one publicly
- Screenshots and a short demo GIF

## License

MIT
