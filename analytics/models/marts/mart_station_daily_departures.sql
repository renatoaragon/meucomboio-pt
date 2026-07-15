-- Scheduled departures per station and weekday: the network's service offer
-- at a glance. Weekday exceptions (calendar_dates) are intentionally out of
-- scope here; this mart reads the base weekly pattern.
with weekdays as (
    select * from (values
        (0, 'mon'), (1, 'tue'), (2, 'wed'), (3, 'thu'),
        (4, 'fri'), (5, 'sat'), (6, 'sun')
    ) as w(weekday_idx, weekday)
),

departures as (
    select
        d.feed_id,
        d.stop_id,
        d.station_name,
        d.departure_secs,
        t."mon", t."tue", t."wed", t."thu", t."fri", t."sat", t."sun",
        t.route_short_name
    from {{ ref('stg_departures') }} d
    join {{ ref('stg_trips') }} t
        on t.feed_id = d.feed_id and t.trip_id = d.trip_id
)

select
    d.feed_id,
    d.stop_id,
    d.station_name,
    w.weekday_idx,
    w.weekday,
    count(*)                                   as departures,
    count(distinct d.route_short_name)         as distinct_routes,
    min(d.departure_secs)                      as first_departure_secs,
    max(d.departure_secs)                      as last_departure_secs
from departures d
join weekdays w
    on (w.weekday = 'mon' and d."mon") or (w.weekday = 'tue' and d."tue")
    or (w.weekday = 'wed' and d."wed") or (w.weekday = 'thu' and d."thu")
    or (w.weekday = 'fri' and d."fri") or (w.weekday = 'sat' and d."sat")
    or (w.weekday = 'sun' and d."sun")
group by 1, 2, 3, 4, 5
