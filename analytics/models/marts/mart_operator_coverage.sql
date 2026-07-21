-- One row per operator (GTFS feed): how much of the network each one runs.
-- With more than one feed loaded (CP, Fertagus), this is the side-by-side
-- picture the single-feed marts can't give -- stations served, routes, trips
-- and total scheduled departures per operator.
with trips as (
    select feed_id, trip_id, route_id
    from {{ ref('stg_trips') }}
),

departures as (
    select feed_id, stop_id, trip_id
    from {{ ref('stg_departures') }}
)

select
    t.feed_id,
    count(distinct d.stop_id)   as stations_served,
    count(distinct t.route_id)  as routes,
    count(distinct t.trip_id)   as trips,
    count(*)                    as scheduled_departures
from trips t
join departures d
    on d.feed_id = t.feed_id and d.trip_id = t.trip_id
group by 1
