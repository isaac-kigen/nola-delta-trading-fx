alter table if exists public.trading_positions
  add column if not exists broker_position_id text;

create index if not exists trading_positions_broker_position_idx
  on public.trading_positions (broker, broker_position_id);

create unique index if not exists trading_positions_open_broker_position_uidx
  on public.trading_positions (broker, broker_position_id)
  where status = 'open' and broker_position_id is not null;

alter table if exists public.broker_callback_events
  add column if not exists broker_position_id text;

create index if not exists broker_callback_events_broker_position_idx
  on public.broker_callback_events (broker_position_id, received_at desc);

update public.trading_positions
set broker_position_id = broker_order_id,
    updated_at = now()
where broker_position_id is null
  and broker = 'paper'
  and broker_order_id is not null;
