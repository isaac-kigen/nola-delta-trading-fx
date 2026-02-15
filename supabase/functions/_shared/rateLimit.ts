import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type LimitReason = "minute_limit" | "daily_limit" | null;

interface ReserveCallResult {
  allowed: boolean;
  minute_remaining: number;
  day_remaining: number;
  wait_seconds: number;
  reason: LimitReason;
}

export class ProviderRateLimitError extends Error {
  statusCode: number;
  provider: string;
  reason: LimitReason;
  waitSeconds: number;
  minuteRemaining: number;
  dayRemaining: number;

  constructor(provider: string, message: string, details: ReserveCallResult) {
    super(message);
    this.name = "ProviderRateLimitError";
    this.statusCode = 429;
    this.provider = provider;
    this.reason = details.reason;
    this.waitSeconds = details.wait_seconds;
    this.minuteRemaining = details.minute_remaining;
    this.dayRemaining = details.day_remaining;
  }
}

export class TwelveRateLimitError extends ProviderRateLimitError {
  constructor(message: string, details: ReserveCallResult) {
    super("twelve_data", message, details);
    this.name = "TwelveRateLimitError";
  }
}

export class FinnhubRateLimitError extends ProviderRateLimitError {
  constructor(message: string, details: ReserveCallResult) {
    super("finnhub", message, details);
    this.name = "FinnhubRateLimitError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveProviderCalls(params: {
  supabase: SupabaseClient;
  provider: string;
  calls: number;
  minuteLimit: number;
  dayLimit: number;
}): Promise<ReserveCallResult> {
  const provider = params.provider.trim().toLowerCase();
  if (!provider) {
    throw new Error("provider is required for rate-limit reservation");
  }

  const { data, error } = await params.supabase
    .rpc("reserve_provider_api_calls", {
      p_provider: provider,
      p_calls: params.calls,
      p_minute_limit: params.minuteLimit,
      p_day_limit: params.dayLimit,
    })
    .single();

  if (error) {
    // Backward compatibility for old deployments that only have reserve_twelve_data_calls.
    if (provider === "twelve_data") {
      const legacy = await params.supabase
        .rpc("reserve_twelve_data_calls", { p_calls: params.calls })
        .single();
      if (legacy.error) {
        throw new Error(`Failed to reserve API call budget for ${provider}: ${legacy.error.message}`);
      }
      if (!legacy.data) {
        throw new Error("reserve_twelve_data_calls returned no data");
      }
      const legacyData = legacy.data as Record<string, unknown>;
      return {
        allowed: Boolean(legacyData.allowed),
        minute_remaining: Number(legacyData.minute_remaining ?? 0),
        day_remaining: Number(legacyData.day_remaining ?? 0),
        wait_seconds: Number(legacyData.wait_seconds ?? 0),
        reason: (legacyData.reason ?? null) as LimitReason,
      };
    }

    throw new Error(`Failed to reserve API call budget for ${provider}: ${error.message}`);
  }

  if (!data) {
    throw new Error("reserve_provider_api_calls returned no data");
  }
  const row = data as Record<string, unknown>;

  return {
    allowed: Boolean(row.allowed),
    minute_remaining: Number(row.minute_remaining ?? 0),
    day_remaining: Number(row.day_remaining ?? 0),
    wait_seconds: Number(row.wait_seconds ?? 0),
    reason: (row.reason ?? null) as LimitReason,
  };
}

export async function waitForProviderCallBudget(params: {
  supabase: SupabaseClient;
  provider: "twelve_data" | "finnhub" | string;
  calls?: number;
  minuteLimit: number;
  dayLimit: number;
  maxMinuteRetries?: number;
  maxWaitMs?: number;
}): Promise<ReserveCallResult> {
  const calls = Math.max(1, Math.trunc(params.calls ?? 1));
  const maxMinuteRetries = params.maxMinuteRetries ?? 2;
  const maxWaitMs = params.maxWaitMs ?? 120_000;
  const provider = params.provider.trim().toLowerCase();

  let attempts = 0;
  let waitedMs = 0;

  while (true) {
    const reserveResult = await reserveProviderCalls({
      supabase: params.supabase,
      provider,
      calls,
      minuteLimit: Math.max(1, Math.trunc(params.minuteLimit)),
      dayLimit: Math.max(1, Math.trunc(params.dayLimit)),
    });

    if (reserveResult.allowed) {
      return reserveResult;
    }

    if (reserveResult.reason === "daily_limit") {
      if (provider === "finnhub") {
        throw new FinnhubRateLimitError("Finnhub daily call limit reached.", reserveResult);
      }
      if (provider === "twelve_data") {
        throw new TwelveRateLimitError("Twelve Data daily call limit reached.", reserveResult);
      }
      throw new ProviderRateLimitError(provider, `${provider} daily call limit reached.`, reserveResult);
    }

    const waitSeconds = Math.max(1, reserveResult.wait_seconds || 1);
    const nextDelay = waitSeconds * 1000 + 200;

    if (
      reserveResult.reason !== "minute_limit" ||
      attempts >= maxMinuteRetries ||
      waitedMs + nextDelay > maxWaitMs
    ) {
      if (provider === "finnhub") {
        throw new FinnhubRateLimitError("Finnhub minute call limit reached.", reserveResult);
      }
      if (provider === "twelve_data") {
        throw new TwelveRateLimitError("Twelve Data minute call limit reached.", reserveResult);
      }
      throw new ProviderRateLimitError(provider, `${provider} minute call limit reached.`, reserveResult);
    }

    await sleep(nextDelay);
    attempts += 1;
    waitedMs += nextDelay;
  }
}

export async function waitForTwelveCallBudget(
  supabase: SupabaseClient,
  calls = 1,
  options: { maxMinuteRetries?: number; maxWaitMs?: number } = {},
): Promise<ReserveCallResult> {
  const minuteLimit = Math.max(1, Number.parseInt(Deno.env.get("TWELVE_API_CALLS_PER_MIN") ?? "8", 10));
  const dayLimit = Math.max(1, Number.parseInt(Deno.env.get("TWELVE_API_CALLS_PER_DAY") ?? "800", 10));
  return waitForProviderCallBudget({
    supabase,
    provider: "twelve_data",
    calls,
    minuteLimit,
    dayLimit,
    maxMinuteRetries: options.maxMinuteRetries,
    maxWaitMs: options.maxWaitMs,
  });
}

export async function waitForFinnhubCallBudget(
  supabase: SupabaseClient,
  calls = 1,
  options: { maxMinuteRetries?: number; maxWaitMs?: number } = {},
): Promise<ReserveCallResult> {
  const minuteLimit = Math.max(1, Number.parseInt(Deno.env.get("FINNHUB_API_CALLS_PER_MIN") ?? "50", 10));
  const dayLimit = Math.max(1, Number.parseInt(Deno.env.get("FINNHUB_API_CALLS_PER_DAY") ?? "50000", 10));
  return waitForProviderCallBudget({
    supabase,
    provider: "finnhub",
    calls,
    minuteLimit,
    dayLimit,
    maxMinuteRetries: options.maxMinuteRetries,
    maxWaitMs: options.maxWaitMs,
  });
}
