# Analytics (dbt + DuckDB)

A small analytical layer over the app's Postgres database. DuckDB attaches
Postgres **read-only** and materializes the marts locally, so analytics never
puts load on the serving database.

## Models

| Model | What it answers |
|---|---|
| `mart_station_daily_departures` | How many trains leave each station per weekday, first/last departure |
| `mart_route_service_span` | Trips, stations served and daily service span per route |
| `mart_sync_health` | Ingestion success rate, duration and warnings from the sync run log |

## Running

```bash
pip install dbt-duckdb
cd analytics
cp profiles.yml.example profiles.yml   # fill in the Postgres connection
dbt deps
DBT_PROFILES_DIR=. dbt build           # run + test
```

Explore the results directly:

```bash
duckdb meucomboio.duckdb "select * from mart_station_daily_departures order by departures desc limit 20"
```
