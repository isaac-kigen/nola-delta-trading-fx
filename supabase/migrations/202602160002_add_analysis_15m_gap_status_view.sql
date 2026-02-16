create or replace view public.v_analysis_15m_gap_status as
with latest_complete as (
  select
    (
      date_trunc('hour', now() at time zone 'utc') +
      ((extract(minute from now() at time zone 'utc')::int / 15) * interval '15 minute') -
      interval '15 minute'
    )::timestamptz as latest_complete_15m_utc
),
last_15m as (
  select
    c.symbol,
    max(c.candle_time) as last_15m_candle_time
  from public.price_candles_15m c
  group by c.symbol
),
last_1m as (
  select
    c.symbol,
    max(c.candle_time) as last_1m_candle_time
  from public.price_candles_1m c
  group by c.symbol
)
select
  s.symbol,
  lc.latest_complete_15m_utc,
  l15.last_15m_candle_time,
  l1.last_1m_candle_time,
  coalesce(r.watch_mode_active, false) as watch_mode_active,
  r.watch_until,
  greatest(
    0,
    case
      when l15.last_15m_candle_time is null then null
      else floor(extract(epoch from (lc.latest_complete_15m_utc - l15.last_15m_candle_time)) / 900)::int
    end
  ) as missing_15m_bars,
  case
    when l15.last_15m_candle_time is null then false
    else l15.last_15m_candle_time >= lc.latest_complete_15m_utc
  end as baseline_up_to_date
from public.strategy_symbol_config s
cross join latest_complete lc
left join last_15m l15 on l15.symbol = s.symbol
left join last_1m l1 on l1.symbol = s.symbol
left join public.sync_symbol_runtime_state r on r.symbol = s.symbol;
