# Backend Smoke Tests

Use this after every deploy or secret/config change.

## Prerequisites

- `curl` installed
- `PROJECT_REF` exported
- Cron secrets exported

## Required environment variables

- `PROJECT_REF`
- `SYNC_CRON_SECRET`
- `EXECUTE_CRON_SECRET`
- `BROKER_SYNC_CRON_SECRET`
- `VALIDATE_CRON_SECRET`

Optional:

- `TEST_SYMBOL` (default `EUR/USD`)
- `VALIDATE_FROM_UTC` (default `2025-01-01T00:00:00Z`)
- `VALIDATE_TO_UTC` (default current UTC time)

## Run

```bash
bash supabase/tests/smoke_pipeline.sh
```

The script prints each request payload and response. It exits non-zero on any non-2xx response.

Sequence currently includes:
- execution worker probe (`probe=true`)
- minute candle sync (latest complete 1m)
- execution worker run
- broker position sync (open + full)
- strategy validation
