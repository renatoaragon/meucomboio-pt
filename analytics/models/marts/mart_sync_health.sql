-- Pipeline observability: ingestion success rate, duration and volume drift
-- straight from the sync run log.
select
    "feedId"                                          as feed_id,
    count(*)                                          as runs,
    count(*) filter (where "ok")                      as ok_runs,
    round(count(*) filter (where "ok") * 100.0 / count(*), 1)
                                                      as success_rate_pct,
    round(avg("durationMs") filter (where "ok") / 1000.0, 1)
                                                      as avg_ok_duration_s,
    max("startedAt") filter (where "ok")              as last_ok_at,
    max("startedAt") filter (where not "ok")          as last_failure_at,
    sum(json_array_length("warnings"))                as total_warnings
from {{ source('raw', 'meucomboio_sync_runs') }}
group by 1
