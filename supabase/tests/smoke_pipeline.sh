#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name" >&2
    exit 1
  fi
}

require_env PROJECT_REF
require_env SYNC_CRON_SECRET
require_env EXECUTE_CRON_SECRET
require_env BROKER_SYNC_CRON_SECRET
require_env VALIDATE_CRON_SECRET

BASE_URL="https://${PROJECT_REF}.supabase.co/functions/v1"
TEST_SYMBOL="${TEST_SYMBOL:-EUR/USD}"
VALIDATE_FROM_UTC="${VALIDATE_FROM_UTC:-2025-01-01T00:00:00Z}"
VALIDATE_TO_UTC="${VALIDATE_TO_UTC:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

call_json() {
  local name="$1"
  local url="$2"
  local secret="$3"
  local body="$4"

  echo ""
  echo "=== ${name} ==="
  echo "POST ${url}"
  echo "BODY: ${body}"

  local response
  response="$(curl -sS -w "\n%{http_code}" -X POST "${url}" \
    -H "x-cron-secret: ${secret}" \
    -H "Content-Type: application/json" \
    -d "${body}")"

  local status
  status="$(echo "${response}" | tail -n1)"
  local payload
  payload="$(echo "${response}" | sed '$d')"

  echo "STATUS: ${status}"
  echo "RESPONSE:"
  echo "${payload}"

  if [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    echo "Request failed for ${name} with status ${status}" >&2
    exit 1
  fi
}

call_json \
  "execute-broker-orders-probe" \
  "${BASE_URL}/execute-broker-orders" \
  "${EXECUTE_CRON_SECRET}" \
  "{\"probe\": true, \"provider\": \"ctrader\"}"

call_json \
  "sync-latest-candle" \
  "${BASE_URL}/sync-latest-candle" \
  "${SYNC_CRON_SECRET}" \
  "{\"run_opportunity_check\": true}"

call_json \
  "execute-broker-orders" \
  "${BASE_URL}/execute-broker-orders" \
  "${EXECUTE_CRON_SECRET}" \
  "{\"limit\": 3}"

call_json \
  "sync-broker-positions-open" \
  "${BASE_URL}/sync-broker-positions" \
  "${BROKER_SYNC_CRON_SECRET}" \
  "{\"only_open\": true, \"limit\": 200}"

call_json \
  "sync-broker-positions-full" \
  "${BASE_URL}/sync-broker-positions" \
  "${BROKER_SYNC_CRON_SECRET}" \
  "{\"only_open\": false, \"limit\": 1000}"

call_json \
  "validate-strategy" \
  "${BASE_URL}/validate-strategy" \
  "${VALIDATE_CRON_SECRET}" \
  "{\"symbol\": \"${TEST_SYMBOL}\", \"from_time_utc\": \"${VALIDATE_FROM_UTC}\", \"to_time_utc\": \"${VALIDATE_TO_UTC}\", \"max_candles\": 3000}"

echo ""
echo "Smoke pipeline passed."
