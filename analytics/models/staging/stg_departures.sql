-- One row per (station, trip) departure event, with times in seconds since
-- midnight of the service day (GTFS convention, values past 24h allowed).
select
    st."feedId"    as feed_id,
    st."stopId"    as stop_id,
    s."name"       as station_name,
    st."tripId"    as trip_id,
    st."seq"       as stop_sequence,
    st."departure" as departure_secs,
    st."arrival"   as arrival_secs
from {{ source('raw', 'meucomboio_stop_times') }} st
join {{ source('raw', 'meucomboio_stops') }} s
    on s."feedId" = st."feedId" and s."stopId" = st."stopId"
