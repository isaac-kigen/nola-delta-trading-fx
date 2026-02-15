create or replace view public.broker_execution_health_30m as
with recent as (
  select
    broker,
    status,
    updated_at
  from public.broker_order_intents
  where updated_at >= now() - interval '30 minutes'
)
select
  broker,
  count(*) as total_intents,
  count(*) filter (where status in ('filled', 'partially_filled')) as success_count,
  count(*) filter (where status in ('error', 'rejected')) as error_count,
  count(*) filter (where status in ('pending', 'sent', 'acknowledged')) as in_flight_count,
  round(
    case when count(*) = 0 then 0
    else (count(*) filter (where status in ('error', 'rejected'))::numeric / count(*)::numeric) * 100
    end,
    2
  ) as error_rate_pct,
  max(updated_at) as latest_update_at
from recent
group by broker;
