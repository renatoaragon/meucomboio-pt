-- Service span per route: how much of the day each line covers, and with
-- how many trains and stations.
select
    t.feed_id,
    t.route_id,
    t.route_short_name,
    t.route_long_name,
    count(distinct t.trip_id)                        as trips,
    count(distinct d.stop_id)                        as stations_served,
    min(d.departure_secs)                            as first_departure_secs,
    max(d.departure_secs)                            as last_departure_secs,
    round((max(d.departure_secs) - min(d.departure_secs)) / 3600.0, 1)
                                                     as service_span_hours
from {{ ref('stg_trips') }} t
join {{ ref('stg_departures') }} d
    on d.feed_id = t.feed_id and d.trip_id = t.trip_id
group by 1, 2, 3, 4
