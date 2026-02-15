export interface TwelveCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | null;
}

interface TwelveTimeSeriesResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: TwelveCandle[];
}

export class TwelveApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "TwelveApiError";
    this.statusCode = statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUtcDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function normalizeCandles(values: TwelveCandle[]): TwelveCandle[] {
  const deduped = new Map<string, TwelveCandle>();
  for (const value of values) {
    if (
      typeof value?.datetime === "string" &&
      typeof value?.open === "string" &&
      typeof value?.high === "string" &&
      typeof value?.low === "string" &&
      typeof value?.close === "string"
    ) {
      deduped.set(value.datetime, value);
    }
  }
  return [...deduped.values()].sort((a, b) =>
    a.datetime.localeCompare(b.datetime)
  );
}

export async function fetchTwelveHourlyCandles(params: {
  apiKey: string;
  symbol: string;
  startAt?: Date;
  endAt?: Date;
  outputsize?: number;
  timeoutMs?: number;
}): Promise<TwelveCandle[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", params.symbol);
  url.searchParams.set("interval", "1h");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("order", "ASC");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", params.apiKey);
  url.searchParams.set("outputsize", String(params.outputsize ?? 5000));

  if (params.startAt) {
    url.searchParams.set("start_date", formatUtcDateTime(params.startAt));
  }
  if (params.endAt) {
    url.searchParams.set("end_date", formatUtcDateTime(params.endAt));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: params.timeoutMs && params.timeoutMs > 0
        ? AbortSignal.timeout(params.timeoutMs)
        : undefined,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new TwelveApiError("Twelve Data request timed out", 504);
    }
    throw error;
  }

  if (!response.ok) {
    throw new TwelveApiError(
      `Twelve Data HTTP ${response.status}: ${response.statusText}`,
      response.status,
    );
  }

  const payload = await response.json() as TwelveTimeSeriesResponse;

  if (payload?.status === "error") {
    throw new TwelveApiError(
      `Twelve Data error: ${payload.message ?? "unknown error"}`,
      payload.code ?? 502,
    );
  }

  if (!Array.isArray(payload?.values)) {
    return [];
  }

  return normalizeCandles(payload.values);
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

function toRetryableError(error: unknown): TwelveApiError {
  if (error instanceof TwelveApiError) {
    return error;
  }
  if (error instanceof Error) {
    return new TwelveApiError(`Twelve Data request failed: ${error.message}`, 503);
  }
  return new TwelveApiError("Twelve Data request failed: unknown error", 503);
}

export async function fetchTwelveHourlyCandlesWithRetry(params: {
  apiKey: string;
  symbol: string;
  startAt?: Date;
  endAt?: Date;
  outputsize?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): Promise<TwelveCandle[]> {
  const maxRetries = Math.max(0, Math.trunc(params.maxRetries ?? 3));
  const baseDelayMs = Math.max(100, Math.trunc(params.baseDelayMs ?? 500));
  const maxDelayMs = Math.max(baseDelayMs, Math.trunc(params.maxDelayMs ?? 5_000));

  let attempt = 0;
  while (true) {
    try {
      return await fetchTwelveHourlyCandles({
        apiKey: params.apiKey,
        symbol: params.symbol,
        startAt: params.startAt,
        endAt: params.endAt,
        outputsize: params.outputsize,
        timeoutMs: params.timeoutMs,
      });
    } catch (error) {
      const normalized = toRetryableError(error);
      const canRetry = attempt < maxRetries && isRetryableStatus(normalized.statusCode);
      if (!canRetry) {
        throw normalized;
      }

      const exponential = Math.min(
        maxDelayMs,
        baseDelayMs * (2 ** attempt),
      );
      const jitter = Math.floor(Math.random() * Math.max(100, Math.floor(baseDelayMs * 0.2)));
      await sleep(exponential + jitter);
      attempt += 1;
    }
  }
}
