-- Enforce one-trade-per-cycle atomically at trigger transition.
-- Entry state = 'triggered'. Executed-state blocking is handled in app logic.

with ranked as (
  select
    id,
    row_number() over (
      partition by symbol, cycle_id
      order by coalesce(triggered_at, created_at) desc, id desc
    ) as rn
  from public.trading_signals
  where cycle_id is not null
    and signal_state = 'triggered'
)
update public.trading_signals s
set
  signal_state = 'invalidated',
  invalidated_at = now(),
  invalidation_reason = coalesce(nullif(s.invalidation_reason, ''), 'deduped_for_cycle_trigger_lock'),
  updated_at = now(),
  last_evaluated_at = now()
from ranked r
where s.id = r.id
  and r.rn > 1;

create unique index if not exists trading_signals_one_trade_per_cycle_triggered_idx
  on public.trading_signals (symbol, cycle_id)
  where cycle_id is not null
    and signal_state = 'triggered';
