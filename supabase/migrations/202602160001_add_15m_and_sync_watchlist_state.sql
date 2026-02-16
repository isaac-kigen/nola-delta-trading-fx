create table if not exists public.price_candles_15m (
  symbol text not null,
  candle_time timestamptz not null,
  open numeric(20, 10) not null,
  high numeric(20, 10) not null,
  low numeric(20, 10) not null,
  close numeric(20, 10) not null,
  volume numeric(28, 10),
  source text not null default 'finnhub',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, candle_time),
  constraint price_candles_15m_high_low_check check (high >= low)
);

create index if not exists price_candles_15m_symbol_time_desc_idx
  on public.price_candles_15m (symbol, candle_time desc);

create or replace function public.upsert_price_candles_15m(
  p_symbol text,
  p_rows jsonb,
  p_source text default 'finnhub'
)
returns integer
language plpgsql
as $$
declare
  v_row_count integer := 0;
begin
  if p_symbol is null or btrim(p_symbol) = '' then
    raise exception 'p_symbol is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;

  with parsed as (
    select
      upper(btrim(p_symbol)) as symbol,
      ((row_data->>'datetime')::timestamp at time zone 'UTC') as candle_time,
      nullif(row_data->>'open', '')::numeric(20, 10) as open,
      nullif(row_data->>'high', '')::numeric(20, 10) as high,
      nullif(row_data->>'low', '')::numeric(20, 10) as low,
      nullif(row_data->>'close', '')::numeric(20, 10) as close,
      nullif(row_data->>'volume', '')::numeric(28, 10) as volume
    from jsonb_array_elements(p_rows) row_data
  )
  insert into public.price_candles_15m (
    symbol,
    candle_time,
    open,
    high,
    low,
    close,
    volume,
    source,
    fetched_at,
    updated_at
  )
  select
    symbol,
    candle_time,
    open,
    high,
    low,
    close,
    volume,
    coalesce(nullif(btrim(p_source), ''), 'finnhub'),
    now(),
    now()
  from parsed
  where candle_time is not null
    and open is not null
    and high is not null
    and low is not null
    and close is not null
  on conflict (symbol, candle_time)
  do update set
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume,
    source = excluded.source,
    fetched_at = now(),
    updated_at = now();

  get diagnostics v_row_count = row_count;
  return v_row_count;
end;
$$;

create table if not exists public.sync_symbol_runtime_state (
  symbol text primary key,
  watch_mode_active boolean not null default false,
  watch_until timestamptz,
  watch_started_at timestamptz,
  watch_reason text,
  watch_direction text,
  watch_setup_score numeric(8, 4),
  last_baseline_15m_candle_time timestamptz,
  last_1m_candle_time timestamptz,
  last_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sync_symbol_runtime_state_watch_idx
  on public.sync_symbol_runtime_state (watch_mode_active, watch_until);
