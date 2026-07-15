-- Trips with their route and weekday service pattern resolved.
select
    t."feedId"     as feed_id,
    t."tripId"     as trip_id,
    t."routeId"    as route_id,
    t."serviceId"  as service_id,
    t."headsign"   as headsign,
    r."shortName"  as route_short_name,
    r."longName"   as route_long_name,
    c."mon", c."tue", c."wed", c."thu", c."fri", c."sat", c."sun",
    c."startDate"  as start_date,
    c."endDate"    as end_date
from {{ source('raw', 'meucomboio_trips') }} t
left join {{ source('raw', 'meucomboio_routes') }} r
    on r."feedId" = t."feedId" and r."routeId" = t."routeId"
left join {{ source('raw', 'meucomboio_calendar') }} c
    on c."feedId" = t."feedId" and c."serviceId" = t."serviceId"
