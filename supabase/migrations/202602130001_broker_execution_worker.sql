alter table public.broker_order_intents
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempted_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text,
  add column if not exists claimed_by_trace_id text;

create index if not exists broker_order_intents_retry_idx
  on public.broker_order_intents (status, next_retry_at, created_at);

create index if not exists broker_order_intents_claimed_trace_idx
  on public.broker_order_intents (claimed_by_trace_id, updated_at desc);

create or replace function public.claim_broker_order_intents(
  p_worker_trace_id text,
  p_limit integer default 5,
  p_reclaim_sent_after_seconds integer default 300
)
returns table (
  id bigint,
  signal_id bigint,
  trace_id text,
  symbol text,
  direction text,
  order_type text,
  requested_entry_price numeric(20, 10),
  stop_loss numeric(20, 10),
  tp1 numeric(20, 10),
  tp2 numeric(20, 10),
  tp3 numeric(20, 10),
  planned_size_units numeric(24, 8),
  broker text,
  request_payload jsonb,
  response_payload jsonb,
  attempt_count integer
)
language plpgsql
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_reclaim_seconds integer := greatest(60, coalesce(p_reclaim_sent_after_seconds, 300));
begin
  if p_worker_trace_id is null or btrim(p_worker_trace_id) = '' then
    raise exception 'p_worker_trace_id is required';
  end if;

  return query
  with candidate as (
    select boi.id
    from public.broker_order_intents boi
    where (
      boi.status = 'pending'
      and (boi.next_retry_at is null or boi.next_retry_at <= now())
    )
    or (
      boi.status = 'sent'
      and boi.updated_at <= now() - make_interval(secs => v_reclaim_seconds)
    )
    order by boi.created_at asc
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.broker_order_intents boi
    set
      status = 'sent',
      attempt_count = coalesce(boi.attempt_count, 0) + 1,
      last_attempted_at = now(),
      next_retry_at = null,
      claimed_by_trace_id = p_worker_trace_id,
      updated_at = now(),
      response_payload = coalesce(boi.response_payload, '{}'::jsonb) || jsonb_build_object(
        'claimed_at', now(),
        'claim_trace_id', p_worker_trace_id,
        'claim_reason', case
          when boi.status = 'sent' then 'reclaim_stale_sent'
          else 'pending'
        end
      )
    from candidate c
    where boi.id = c.id
    returning boi.*
  )
  select
    c.id,
    c.signal_id,
    c.trace_id,
    c.symbol,
    c.direction,
    c.order_type,
    c.requested_entry_price,
    c.stop_loss,
    c.tp1,
    c.tp2,
    c.tp3,
    c.planned_size_units,
    c.broker,
    c.request_payload,
    c.response_payload,
    c.attempt_count
  from claimed c
  order by c.created_at asc;
end;
$$;

create or replace function public.finalize_broker_order_intent(
  p_intent_id bigint,
  p_status text,
  p_broker_order_id text default null,
  p_response_payload jsonb default '{}'::jsonb,
  p_last_error text default null,
  p_next_retry_seconds integer default null
)
returns public.broker_order_intents
language plpgsql
as $$
declare
  v_row public.broker_order_intents%rowtype;
  v_next_retry timestamptz := null;
  v_clean_error text := null;
begin
  if p_intent_id is null then
    raise exception 'p_intent_id is required';
  end if;

  if p_status is null or btrim(p_status) = '' then
    raise exception 'p_status is required';
  end if;

  if p_next_retry_seconds is not null then
    v_next_retry := now() + make_interval(secs => greatest(30, p_next_retry_seconds));
  end if;

  if p_last_error is not null and btrim(p_last_error) <> '' then
    v_clean_error := p_last_error;
  end if;

  update public.broker_order_intents boi
  set
    status = p_status,
    broker_order_id = coalesce(nullif(p_broker_order_id, ''), boi.broker_order_id),
    response_payload = coalesce(boi.response_payload, '{}'::jsonb) || coalesce(p_response_payload, '{}'::jsonb),
    last_error = case
      when p_status in ('filled', 'acknowledged', 'partially_filled', 'cancelled') then null
      else v_clean_error
    end,
    next_retry_at = case
      when p_status = 'pending' then coalesce(v_next_retry, now() + interval '60 seconds')
      else null
    end,
    updated_at = now()
  where boi.id = p_intent_id
  returning boi.*
    into v_row;

  if not found then
    raise exception 'Broker order intent % not found', p_intent_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.enqueue_broker_order_from_signal(
  p_signal_id bigint,
  p_trace_id text default null,
  p_broker text default null
)
returns bigint
language plpgsql
as $$
declare
  v_signal public.trading_signals%rowtype;
  v_trace text;
  v_order_id bigint;
  v_order_type text;
  v_broker text;
begin
  select *
    into v_signal
  from public.trading_signals
  where id = p_signal_id;

  if not found then
    raise exception 'Signal % not found', p_signal_id;
  end if;

  if v_signal.direction not in ('long', 'short') then
    raise exception 'Signal % has invalid direction %', p_signal_id, v_signal.direction;
  end if;

  v_trace := coalesce(nullif(p_trace_id, ''), v_signal.trace_id);
  v_order_type := case
    when v_signal.trigger_policy = 'limit' then 'limit'
    when v_signal.trigger_policy = 'market' then 'market'
    else 'market'
  end;
  v_broker := coalesce(nullif(p_broker, ''), 'paper');

  insert into public.broker_order_intents (
    signal_id,
    trace_id,
    symbol,
    direction,
    order_type,
    requested_entry_price,
    stop_loss,
    tp1,
    tp2,
    tp3,
    planned_size_units,
    broker,
    request_payload
  ) values (
    v_signal.id,
    v_trace,
    v_signal.symbol,
    v_signal.direction,
    v_order_type,
    v_signal.entry_price,
    v_signal.stop_loss,
    v_signal.tp1,
    v_signal.tp2,
    v_signal.tp3,
    v_signal.position_size_units,
    v_broker,
    jsonb_build_object(
      'source', 'enqueue_broker_order_from_signal',
      'signal_state', v_signal.signal_state,
      'strategy_version', v_signal.strategy_version
    )
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;
