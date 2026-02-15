-- Run this in Supabase SQL Editor after replacing placeholders.
-- Required extensions for SQL cron HTTP jobs:
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
-- Security note:
--   If REQUIRE_INTERNAL_AUTH=true (recommended), each job must include
--   its matching x-cron-secret header.

-- 1) Minute candle sync + strategy check (runs every minute).
select cron.schedule(
  'fx-sync-main',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-latest-candle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<SYNC_CRON_SECRET>'
    ),
    body := jsonb_build_object(
      'run_opportunity_check', true
    )
  ) as request_id;
  $$
);

-- 2) Broker execution worker cron is optional.
--    Recommended mode now is on-demand dispatch from signal creation
--    (`BROKER_EXECUTION_DISPATCH_ON_SIGNAL=true`), which only runs execution
--    when a new broker intent is enqueued.
--
-- Fallback cron (optional):
-- select cron.schedule(
--   'fx-broker-execution',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', '<EXECUTE_CRON_SECRET>'
--     ),
--     body := jsonb_build_object(
--       'limit', 5
--     )
--   ) as request_id;
--   $$
-- );
--
-- 3) Broker position reconciliation cron is also optional fallback:
-- select cron.schedule(
--   'fx-broker-position-sync',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-broker-positions',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', '<BROKER_SYNC_CRON_SECRET>'
--     ),
--     body := jsonb_build_object(
--       'only_open', true,
--       'limit', 150
--     )
--   ) as request_id;
--   $$
-- );
--
-- 4) Full reconciliation (recommended) to heal missed callbacks:
-- select cron.schedule(
--   'fx-broker-position-sync-full',
--   '17 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-broker-positions',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', '<BROKER_SYNC_CRON_SECRET>'
--     ),
--     body := jsonb_build_object(
--       'only_open', false,
--       'limit', 1000
--     )
--   ) as request_id;
--   $$
-- );

-- Optional cleanup / recreate helpers:
-- select cron.unschedule('fx-sync-main');
-- select cron.unschedule('fx-broker-execution');
-- select cron.unschedule('fx-broker-position-sync');
-- select cron.unschedule('fx-broker-position-sync-full');
