-- Photon v3.1 strict structure config + one-trade-per-cycle support.

alter table if exists public.strategy_symbol_config
  add column if not exists liquidity_eps_pips numeric(10, 4) not null default 2.0,
  add column if not exists zone_base_candles integer not null default 3,
  add column if not exists zone_base_max_pips numeric(10, 4) not null default 12.0,
  add column if not exists zone_impulse_candles integer not null default 3,
  add column if not exists zone_impulse_pips numeric(10, 4) not null default 20.0,
  add column if not exists zone_invalidation_pips numeric(10, 4) not null default 1.0,
  add column if not exists one_trade_per_cycle boolean not null default true;

update public.strategy_symbol_config
set
  strategy_version = 'v3.1.0-photon-zones',
  updated_at = now()
where strategy_version is null
   or strategy_version = ''
   or strategy_version like 'v2.%'
   or strategy_version like 'v3.0.%';

-- JPY symbols use tighter fixed EQ tolerance by default.
update public.strategy_symbol_config
set
  liquidity_eps_pips = 0.2,
  updated_at = now()
where symbol like '%JPY%'
  and liquidity_eps_pips = 2.0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategy_symbol_config_zone_base_candles_check'
      and conrelid = 'public.strategy_symbol_config'::regclass
  ) then
    alter table public.strategy_symbol_config
      add constraint strategy_symbol_config_zone_base_candles_check
      check (zone_base_candles between 3 and 5) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategy_symbol_config_zone_impulse_candles_check'
      and conrelid = 'public.strategy_symbol_config'::regclass
  ) then
    alter table public.strategy_symbol_config
      add constraint strategy_symbol_config_zone_impulse_candles_check
      check (zone_impulse_candles between 1 and 6) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategy_symbol_config_liquidity_eps_pips_check'
      and conrelid = 'public.strategy_symbol_config'::regclass
  ) then
    alter table public.strategy_symbol_config
      add constraint strategy_symbol_config_liquidity_eps_pips_check
      check (liquidity_eps_pips > 0 and liquidity_eps_pips <= 10) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategy_symbol_config_zone_base_max_pips_check'
      and conrelid = 'public.strategy_symbol_config'::regclass
  ) then
    alter table public.strategy_symbol_config
      add constraint strategy_symbol_config_zone_base_max_pips_check
      check (zone_base_max_pips > 0 and zone_base_max_pips <= 200) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategy_symbol_config_zone_impulse_pips_check'
      and conrelid = 'public.strategy_symbol_config'::regclass
  ) then
    alter table public.strategy_symbol_config
      add constraint strategy_symbol_config_zone_impulse_pips_check
      check (zone_impulse_pips > 0 and zone_impulse_pips <= 500) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategy_symbol_config_zone_invalidation_pips_check'
      and conrelid = 'public.strategy_symbol_config'::regclass
  ) then
    alter table public.strategy_symbol_config
      add constraint strategy_symbol_config_zone_invalidation_pips_check
      check (zone_invalidation_pips > 0 and zone_invalidation_pips <= 50) not valid;
  end if;
end;
$$;

alter table if exists public.trading_signals
  add column if not exists cycle_id text;

alter table if exists public.trading_opportunity_checks
  add column if not exists cycle_id text;

create index if not exists trading_signals_symbol_cycle_idx
  on public.trading_signals (symbol, cycle_id, created_at desc);

create index if not exists trading_opportunity_checks_symbol_cycle_idx
  on public.trading_opportunity_checks (symbol, cycle_id, checked_at desc);

update public.strategy_runtime_config
set
  value = jsonb_set(
    jsonb_set(
      coalesce(value, '{}'::jsonb),
      '{strategy_version}',
      to_jsonb('v3.1.0-photon-zones'::text),
      true
    ),
    '{setup_label}',
    to_jsonb('setup_score'::text),
    true
  ),
  updated_at = now()
where key = 'global';
