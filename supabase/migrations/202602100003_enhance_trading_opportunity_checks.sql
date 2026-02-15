alter table public.trading_opportunity_checks
  add column if not exists direction text not null default 'none',
  add column if not exists strategy_name text not null default 'unspecified',
  add column if not exists htf_timeframe text,
  add column if not exists entry_price numeric(20, 10),
  add column if not exists stop_loss numeric(20, 10),
  add column if not exists tp1 numeric(20, 10),
  add column if not exists tp2 numeric(20, 10),
  add column if not exists tp3 numeric(20, 10),
  add column if not exists risk_r numeric(20, 10),
  add column if not exists telegram_notified boolean not null default false,
  add column if not exists telegram_notified_at timestamptz,
  add column if not exists telegram_message_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trading_opportunity_checks_direction_check'
      and conrelid = 'public.trading_opportunity_checks'::regclass
  ) then
    alter table public.trading_opportunity_checks
      add constraint trading_opportunity_checks_direction_check
      check (direction in ('long', 'short', 'none'));
  end if;
end;
$$;

create index if not exists trading_opportunity_checks_symbol_candle_idx
  on public.trading_opportunity_checks (symbol, latest_candle_time desc);
