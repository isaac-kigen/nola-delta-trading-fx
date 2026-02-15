-- Production-oriented risk defaults:
-- - risk_per_trade_pct default -> 0.55
-- - existing rows at legacy 0.50 -> 0.55
-- - global account_equity_usd default anchor -> 5000 (only if still legacy 10000/missing)

alter table if exists public.strategy_symbol_config
  alter column risk_per_trade_pct set default 0.55;

update public.strategy_symbol_config
set
  risk_per_trade_pct = 0.55,
  updated_at = now()
where risk_per_trade_pct = 0.50;

insert into public.strategy_runtime_config (key, value)
values (
  'global',
  jsonb_build_object('account_equity_usd', 5000)
)
on conflict (key) do nothing;

update public.strategy_runtime_config
set
  value = jsonb_set(
    coalesce(value, '{}'::jsonb),
    '{account_equity_usd}',
    to_jsonb(
      case
        when not (coalesce(value->>'account_equity_usd', '') ~ '^[0-9]+(\.[0-9]+)?$')
          then 5000::numeric
        when (value->>'account_equity_usd')::numeric = 10000::numeric
          then 5000::numeric
        else (value->>'account_equity_usd')::numeric
      end
    ),
    true
  ),
  updated_at = now()
where key = 'global';
