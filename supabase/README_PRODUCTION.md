# Supabase FX Pipeline Production Runbook

## 1) Apply schema changes

```bash
npx supabase db push
```

This run includes:
- `202602130005_broker_position_tracking.sql` (broker position reconciliation)
- `202602140001_finnhub_structure_pipeline.sql` (Finnhub + 1m storage + provider rate limits)
- `202602150001_photon_zones_liquidity_cycle.sql` (strict 15M zone/sweep gates + one-trade-per-cycle)
- `202602150002_cycle_atomic_trigger_lock.sql` (atomic one-trade-per-cycle trigger lock)
- `202602170001_fix_analysis_gap_market_hours.sql` (FX-market-hours-aware 15m gap math)

`202602130005_broker_position_tracking.sql` adds:
- `trading_positions.broker_position_id`
- `broker_callback_events.broker_position_id`
- indexes/uniqueness for broker position reconciliation

## 2) Set secrets

Use `supabase/functions/.env.example` as the source of truth and set all values in Supabase Secrets.

Minimum production requirements:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FINNHUB_API_KEY`
- `SYNC_CRON_SECRET`
- `CHECK_CRON_SECRET`
- `BACKFILL_CRON_SECRET`
- `VALIDATE_CRON_SECRET`
- `EXECUTE_CRON_SECRET`
- `BROKER_SYNC_CRON_SECRET`
- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_OAUTH_STATE_SECRET`
- `BROKER_CALLBACK_SECRET` (or `CTRADER_CALLBACK_SECRET`)

Recommended Photon strategy tuning (if not set in DB/runtime config):
- `STRUCTURE_MAX_1M_CANDLES` (default `12000`)
- `STRUCTURE_MAX_15M_CANDLES` (default derived from 1m window)
- `STRUCTURE_REAL_1M_BURST_LIMIT` (default `600`)
- `STRUCTURE_FETCH_PAGE_SIZE` (default `1000`)
- `PHOTON_REQUIRE_REAL_1M_TRIGGER` (default `true`)
- `PHOTON_REAL_1M_FRESHNESS_MINUTES` (default `20`)
- `PHOTON_MIN_RR` (default `2.0`)
- `PHOTON_ZONE_BASE_CANDLES` (default `3`)
- `PHOTON_ZONE_BASE_MAX_PIPS` (default `12`)
- `PHOTON_ZONE_IMPULSE_CANDLES` (default `3`)
- `PHOTON_ZONE_IMPULSE_PIPS` (default `20`)
- `PHOTON_ZONE_INVALIDATION_PIPS` (default `1`)
- `PHOTON_LIQUIDITY_EPS_PIPS` (default `2`)
- `PHOTON_LIQUIDITY_EPS_PIPS_JPY` (default `0.2`)
- `PHOTON_ONE_TRADE_PER_CYCLE` (default `true`)

Recommended hardening flags:
- `REQUIRE_INTERNAL_AUTH=true`
- `REQUIRE_CALLBACK_AUTH=true`
- `LOCK_FAIL_OPEN=false`
- `CTRADER_OAUTH_ENFORCE_STATE=true`
- `CTRADER_OAUTH_ALLOW_LEGACY_STATE=false`
- `BROKER_CIRCUIT_BREAKER_ENABLED=true`
- `BROKER_CIRCUIT_BREAKER_WINDOW_MINUTES=30`
- `BROKER_CIRCUIT_BREAKER_MIN_SAMPLE=8`
- `BROKER_CIRCUIT_BREAKER_MAX_ERRORS=6`
- `BROKER_CIRCUIT_BREAKER_MAX_ERROR_RATE_PCT=70`
- `CTRADER_RUNTIME_BRIDGE_FALLBACK=true` (recommended during edge-runtime operation)

## 3) Deploy functions

```bash
npx supabase functions deploy sync-latest-candle
npx supabase functions deploy check-trading-opportunity
npx supabase functions deploy backfill-candle-history
npx supabase functions deploy validate-strategy
npx supabase functions deploy execute-broker-orders
npx supabase functions deploy sync-broker-positions
npx supabase functions deploy ctrader-callback
npx supabase functions deploy ctrader-oauth-callback
```

## 4) Schedule jobs

Use `supabase/cron/setup_broker_jobs.sql` and replace placeholders:
- `<PROJECT_REF>`
- `<SYNC_CRON_SECRET>`
- optionally `<EXECUTE_CRON_SECRET>`, `<BROKER_SYNC_CRON_SECRET>`

Recommended:
- Keep quick sync (`only_open=true`) every 5 minutes.
- Add full reconciliation (`only_open=false`) hourly to recover from missed callbacks.
- `sync-latest-candle` should run every minute: it now does 15m baseline/catch-up continuously, and only does 1m polling during watch bursts.

## 5) cTrader OAuth

1. Set redirect URL in Spotware app to:
   - `https://<PROJECT_REF>.supabase.co/functions/v1/ctrader-oauth-callback`
2. Open:
   - `https://<PROJECT_REF>.supabase.co/functions/v1/ctrader-oauth-callback`
3. Complete consent and confirm `broker_oauth_tokens` has an active token row.

## 6) Smoke tests

```bash
# Full smoke sequence
bash supabase/tests/smoke_pipeline.sh

# Minute sync (latest complete 1m candle per symbol)
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/sync-latest-candle" \
  -H "x-cron-secret: <SYNC_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"run_opportunity_check": true}'

# Manual execution worker
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders" \
  -H "x-cron-secret: <EXECUTE_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'

# Readiness probe (no intent claims, no execution)
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders" \
  -H "x-cron-secret: <EXECUTE_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"probe": true, "provider": "ctrader"}'

# Deep cTrader probe (opens WS, validates runtime, then closes)
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders" \
  -H "x-cron-secret: <EXECUTE_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"probe": true, "probe_deep": true, "provider": "ctrader"}'

# Emergency override (bypass circuit-breaker once)
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders" \
  -H "x-cron-secret: <EXECUTE_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 2, "force": true}'

# Controlled bypass without "force" semantics
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders" \
  -H "x-cron-secret: <EXECUTE_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 2, "skip_circuit_breaker": true}'

# Optional: chaos test (staging only)
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/execute-broker-orders" \
  -H "x-cron-secret: <EXECUTE_CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 3, "chaos_mode": true, "chaos_failure_rate_pct": 30}'
```

## 7) Operational checks

- `ops_function_runs`: failures/latency by function
- `ops_alerts`: lock/auth/broker warnings and errors
- `broker_order_intents`: stuck `pending/sent/acknowledged`
- `broker_callback_events`: callback ingestion + dedupe
- `trading_positions`: ensure `broker_position_id` is being populated for live brokers
- `broker_execution_health_30m` view: quick broker health/error-rate snapshot

## 8) CI Gate

Repository now includes `.github/workflows/supabase-functions-ci.yml`:
- runs `deno check` on all function TypeScript files
- runs unit tests in `supabase/functions/_shared/auth_test.ts`
- validates `supabase/tests/smoke_pipeline.sh` shell syntax
