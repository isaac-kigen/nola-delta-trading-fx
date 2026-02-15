create table if not exists public.pipeline_locks (
  lock_name text primary key,
  owner_trace_id text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists pipeline_locks_expires_idx
  on public.pipeline_locks (expires_at);

create or replace function public.acquire_pipeline_lock(
  p_lock_name text,
  p_owner_trace_id text,
  p_ttl_seconds integer default 3600
)
returns table (
  acquired boolean,
  lock_name text,
  owner_trace_id text,
  expires_at timestamptz
)
language plpgsql
as $$
declare
  v_ttl_seconds integer := greatest(60, coalesce(p_ttl_seconds, 3600));
begin
  if p_lock_name is null or btrim(p_lock_name) = '' then
    raise exception 'p_lock_name is required';
  end if;
  if p_owner_trace_id is null or btrim(p_owner_trace_id) = '' then
    raise exception 'p_owner_trace_id is required';
  end if;

  delete from public.pipeline_locks
  where lock_name = p_lock_name
    and expires_at <= now();

  insert into public.pipeline_locks (lock_name, owner_trace_id, acquired_at, expires_at)
  values (
    p_lock_name,
    p_owner_trace_id,
    now(),
    now() + make_interval(secs => v_ttl_seconds)
  )
  on conflict (lock_name) do nothing;

  if found then
    return query
      select
        true as acquired,
        p_lock_name as lock_name,
        p_owner_trace_id as owner_trace_id,
        now() + make_interval(secs => v_ttl_seconds) as expires_at;
    return;
  end if;

  return query
    select
      false as acquired,
      l.lock_name,
      l.owner_trace_id,
      l.expires_at
    from public.pipeline_locks l
    where l.lock_name = p_lock_name;
end;
$$;

create or replace function public.release_pipeline_lock(
  p_lock_name text,
  p_owner_trace_id text default null
)
returns boolean
language plpgsql
as $$
declare
  v_deleted integer := 0;
begin
  if p_lock_name is null or btrim(p_lock_name) = '' then
    return false;
  end if;

  if p_owner_trace_id is null or btrim(p_owner_trace_id) = '' then
    delete from public.pipeline_locks
    where lock_name = p_lock_name;
  else
    delete from public.pipeline_locks
    where lock_name = p_lock_name
      and owner_trace_id = p_owner_trace_id;
  end if;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
