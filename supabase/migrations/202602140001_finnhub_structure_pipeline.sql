-- Minute candles for structure strategy (4H/15M/1M).
create table if not exists public.price_candles_1m (
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
  constraint price_candles_1m_high_low_check check (high >= low)
);

create index if not exists price_candles_1m_symbol_time_desc_idx
  on public.price_candles_1m (symbol, candle_time desc);

-- Generic provider API usage tracker (works for Finnhub and any future providers).
create table if not exists public.provider_api_usage (
  provider text primary key,
  minute_window_start timestamptz not null default date_trunc('minute', now()),
  minute_calls integer not null default 0 check (minute_calls >= 0),
  day_window_start date not null default (now() at time zone 'utc')::date,
  day_calls integer not null default 0 check (day_calls >= 0),
  updated_at timestamptz not null default now()
);

insert into public.provider_api_usage (provider)
values ('finnhub')
on conflict (provider) do nothing;

insert into public.provider_api_usage (provider)
values ('twelve_data')
on conflict (provider) do nothing;

create or replace function public.reserve_provider_api_calls(
  p_provider text,
  p_calls integer default 1,
  p_minute_limit integer default 60,
  p_day_limit integer default 50000
)
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
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_calls integer := greatest(1, coalesce(p_calls, 1));
  v_minute_limit integer := greatest(1, coalesce(p_minute_limit, 60));
  v_day_limit integer := greatest(1, coalesce(p_day_limit, 50000));
  v_now_utc timestamp := now() at time zone 'utc';
  v_minute_start timestamptz := date_trunc('minute', v_now_utc) at time zone 'utc';
  v_day_start date := v_now_utc::date;
  v_wait_seconds integer;
  v_row public.provider_api_usage%rowtype;
begin
  if v_provider = '' then
    raise exception 'p_provider is required';
  end if;

  insert into public.provider_api_usage (provider)
  values (v_provider)
  on conflict (provider) do nothing;

  select *
    into v_row
  from public.provider_api_usage
  where provider = v_provider
  for update;

  if date_trunc('minute', v_row.minute_window_start) <> v_minute_start then
    v_row.minute_window_start := v_minute_start;
    v_row.minute_calls := 0;
  end if;

  if v_row.day_window_start <> v_day_start then
    v_row.day_window_start := v_day_start;
    v_row.day_calls := 0;
  end if;

  if v_row.day_calls + v_calls > v_day_limit then
    v_wait_seconds := greatest(
      1,
      ceil(extract(epoch from ((date_trunc('day', v_now_utc) + interval '1 day') - v_now_utc)))::integer
    );

    update public.provider_api_usage
    set minute_window_start = v_row.minute_window_start,
        minute_calls = v_row.minute_calls,
        day_window_start = v_row.day_window_start,
        day_calls = v_row.day_calls,
        updated_at = now()
    where provider = v_provider;

    return query
      select false,
             greatest(0, v_minute_limit - v_row.minute_calls),
             greatest(0, v_day_limit - v_row.day_calls),
             v_wait_seconds,
             'daily_limit'::text;
    return;
  end if;

  if v_row.minute_calls + v_calls > v_minute_limit then
    v_wait_seconds := greatest(
      1,
      ceil(extract(epoch from ((date_trunc('minute', v_now_utc) + interval '1 minute') - v_now_utc)))::integer
    );

    update public.provider_api_usage
    set minute_window_start = v_row.minute_window_start,
        minute_calls = v_row.minute_calls,
        day_window_start = v_row.day_window_start,
        day_calls = v_row.day_calls,
        updated_at = now()
    where provider = v_provider;

    return query
      select false,
             greatest(0, v_minute_limit - v_row.minute_calls),
             greatest(0, v_day_limit - v_row.day_calls),
             v_wait_seconds,
             'minute_limit'::text;
    return;
  end if;

  v_row.minute_calls := v_row.minute_calls + v_calls;
  v_row.day_calls := v_row.day_calls + v_calls;

  update public.provider_api_usage
  set minute_window_start = v_row.minute_window_start,
      minute_calls = v_row.minute_calls,
      day_window_start = v_row.day_window_start,
      day_calls = v_row.day_calls,
      updated_at = now()
  where provider = v_provider;

  return query
    select true,
           greatest(0, v_minute_limit - v_row.minute_calls),
           greatest(0, v_day_limit - v_row.day_calls),
           0,
           null::text;
end;
$$;

create or replace function public.reserve_finnhub_calls(
  p_calls integer default 1,
  p_minute_limit integer default 60,
  p_day_limit integer default 50000
)
returns table (
  allowed boolean,
  minute_remaining integer,
  day_remaining integer,
  wait_seconds integer,
  reason text
)
language sql
as $$
  select *
  from public.reserve_provider_api_calls(
    p_provider => 'finnhub',
    p_calls => p_calls,
    p_minute_limit => p_minute_limit,
    p_day_limit => p_day_limit
  );
$$;

create or replace function public.upsert_price_candles_1m(
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
  insert into public.price_candles_1m (
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
