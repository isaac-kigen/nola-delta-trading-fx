create or replace function public.fx_is_market_open_15m(p_ts timestamptz)
returns boolean
language sql
immutable
as $$
  select case
    when extract(dow from p_ts at time zone 'utc') = 6 then false
    when extract(dow from p_ts at time zone 'utc') = 0
      and (p_ts at time zone 'utc')::time < time '22:00' then false
    when extract(dow from p_ts at time zone 'utc') = 5
      and (p_ts at time zone 'utc')::time >= time '22:00' then false
    else true
  end
$$;

create or replace view public.v_analysis_15m_gap_status as
with now_utc as (
  select now() at time zone 'utc' as now_utc
),
latest_complete as (
  select (
    case
      when extract(dow from n.now_utc) = 6 then
        date_trunc('day', n.now_utc) - interval '1 day' + interval '21 hour 45 minute'
      when extract(dow from n.now_utc) = 0 and n.now_utc::time < time '22:00' then
        date_trunc('day', n.now_utc) - interval '2 day' + interval '21 hour 45 minute'
      when extract(dow from n.now_utc) = 5 and n.now_utc::time >= time '22:00' then
        date_trunc('day', n.now_utc) + interval '21 hour 45 minute'
      else
        date_trunc('hour', n.now_utc) +
        ((extract(minute from n.now_utc)::int / 15) * interval '15 minute') -
        interval '15 minute'
    end
  ) at time zone 'utc' as latest_complete_15m_utc
  from now_utc n
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
  case
    when l15.last_15m_candle_time is null then null
    when l15.last_15m_candle_time >= lc.latest_complete_15m_utc then 0
    else (
      select count(*)::int
      from generate_series(
        l15.last_15m_candle_time + interval '15 minute',
        lc.latest_complete_15m_utc,
        interval '15 minute'
      ) as gs(ts)
      where public.fx_is_market_open_15m(gs.ts)
    )
  end as missing_15m_bars,
  case
    when l15.last_15m_candle_time is null then false
    else l15.last_15m_candle_time >= lc.latest_complete_15m_utc
  end as baseline_up_to_date
from public.strategy_symbol_config s
cross join latest_complete lc
left join last_15m l15 on l15.symbol = s.symbol
left join last_1m l1 on l1.symbol = s.symbol
left join public.sync_symbol_runtime_state r on r.symbol = s.symbol;
