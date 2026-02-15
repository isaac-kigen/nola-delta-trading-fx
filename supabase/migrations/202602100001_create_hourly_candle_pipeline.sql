-- Stores normalized 1-hour OHLCV candles.
create table if not exists public.price_candles_1h (
  symbol text not null,
  candle_time timestamptz not null,
  open numeric(20, 10) not null,
  high numeric(20, 10) not null,
  low numeric(20, 10) not null,
  close numeric(20, 10) not null,
  volume numeric(28, 10),
  source text not null default 'twelve_data',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, candle_time),
  constraint price_candles_1h_high_low_check check (high >= low)
);

create index if not exists price_candles_1h_symbol_time_desc_idx
  on public.price_candles_1h (symbol, candle_time desc);

-- Tracks shared Twelve Data request usage (8/minute, 800/day).
create table if not exists public.twelve_data_api_usage (
  key text primary key,
  minute_window_start timestamptz not null default date_trunc('minute', now()),
  minute_calls integer not null default 0 check (minute_calls >= 0),
  day_window_start date not null default (now() at time zone 'utc')::date,
  day_calls integer not null default 0 check (day_calls >= 0),
  updated_at timestamptz not null default now()
);

insert into public.twelve_data_api_usage (key)
values ('global')
on conflict (key) do nothing;

create or replace function public.reserve_twelve_data_calls(p_calls integer default 1)
returns table (
  allowed boolean,
  minute_remaining integer,
  day_remaining integer,
  wait_seconds integer,
  reason text
)
language plpgsql
as $$
declare
  v_row public.twelve_data_api_usage%rowtype;
  v_calls integer := greatest(1, coalesce(p_calls, 1));
  v_now_utc timestamp := now() at time zone 'utc';
  v_minute_start timestamptz := date_trunc('minute', v_now_utc) at time zone 'utc';
  v_day_start date := v_now_utc::date;
  v_wait_seconds integer;
begin
  insert into public.twelve_data_api_usage (key)
  values ('global')
  on conflict (key) do nothing;

  select *
    into v_row
  from public.twelve_data_api_usage
  where key = 'global'
  for update;

  if date_trunc('minute', v_row.minute_window_start) <> v_minute_start then
    v_row.minute_window_start := v_minute_start;
    v_row.minute_calls := 0;
  end if;

  if v_row.day_window_start <> v_day_start then
    v_row.day_window_start := v_day_start;
    v_row.day_calls := 0;
  end if;

  if v_row.day_calls + v_calls > 800 then
    v_wait_seconds := greatest(
      1,
      ceil(extract(epoch from ((date_trunc('day', v_now_utc) + interval '1 day') - v_now_utc)))::integer
    );

    update public.twelve_data_api_usage
    set minute_window_start = v_row.minute_window_start,
        minute_calls = v_row.minute_calls,
        day_window_start = v_row.day_window_start,
        day_calls = v_row.day_calls,
        updated_at = now()
    where key = 'global';

    return query
      select false,
             greatest(0, 8 - v_row.minute_calls),
             greatest(0, 800 - v_row.day_calls),
             v_wait_seconds,
             'daily_limit'::text;
    return;
  end if;

  if v_row.minute_calls + v_calls > 8 then
    v_wait_seconds := greatest(
      1,
      ceil(extract(epoch from ((date_trunc('minute', v_now_utc) + interval '1 minute') - v_now_utc)))::integer
    );

    update public.twelve_data_api_usage
    set minute_window_start = v_row.minute_window_start,
        minute_calls = v_row.minute_calls,
        day_window_start = v_row.day_window_start,
        day_calls = v_row.day_calls,
        updated_at = now()
    where key = 'global';

    return query
      select false,
             greatest(0, 8 - v_row.minute_calls),
             greatest(0, 800 - v_row.day_calls),
             v_wait_seconds,
             'minute_limit'::text;
    return;
  end if;

  v_row.minute_calls := v_row.minute_calls + v_calls;
  v_row.day_calls := v_row.day_calls + v_calls;

  update public.twelve_data_api_usage
  set minute_window_start = v_row.minute_window_start,
      minute_calls = v_row.minute_calls,
      day_window_start = v_row.day_window_start,
      day_calls = v_row.day_calls,
      updated_at = now()
  where key = 'global';

  return query
    select true,
           greatest(0, 8 - v_row.minute_calls),
           greatest(0, 800 - v_row.day_calls),
           0,
           null::text;
end;
$$;

create or replace function public.upsert_price_candles_1h(p_symbol text, p_rows jsonb)
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
  insert into public.price_candles_1h (
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
    'twelve_data',
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
