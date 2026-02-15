export interface FinnhubNormalizedCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | null;
}

interface FinnhubCandleResponse {
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  s?: string;
  t?: number[];
  v?: number[];
  error?: string;
}

export class FinnhubApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "FinnhubApiError";
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

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return normalized;
  if (normalized.includes(":")) return normalized;

  const source = (Deno.env.get("FINNHUB_FOREX_SOURCE") ?? "OANDA").trim().toUpperCase() || "OANDA";
  const [baseRaw, quoteRaw] = normalized.replace("_", "/").split("/");
  const base = (baseRaw ?? "").trim();
  const quote = (quoteRaw ?? "").trim();
  if (!base || !quote) return normalized;

  return `${source}:${base}_${quote}`;
}

function normalizeCandles(response: FinnhubCandleResponse): FinnhubNormalizedCandle[] {
  const opens = Array.isArray(response.o) ? response.o : [];
  const highs = Array.isArray(response.h) ? response.h : [];
  const lows = Array.isArray(response.l) ? response.l : [];
  const closes = Array.isArray(response.c) ? response.c : [];
  const timestamps = Array.isArray(response.t) ? response.t : [];
  const volumes = Array.isArray(response.v) ? response.v : [];

  const count = Math.min(opens.length, highs.length, lows.length, closes.length, timestamps.length);
  const rows: FinnhubNormalizedCandle[] = [];
  const dedupe = new Set<string>();

  for (let i = 0; i < count; i += 1) {
    const ts = timestamps[i];
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    const volume = i < volumes.length ? volumes[i] : null;

    if (
      !Number.isFinite(ts) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }

    const dt = formatUtcDateTime(new Date(Number(ts) * 1000));
    if (dedupe.has(dt)) continue;
    dedupe.add(dt);

    rows.push({
      datetime: dt,
      open: Number(open).toString(),
      high: Number(high).toString(),
      low: Number(low).toString(),
      close: Number(close).toString(),
      volume: volume === null || volume === undefined || !Number.isFinite(volume)
        ? null
        : Number(volume).toString(),
    });
  }

  return rows.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

function toRetryableError(error: unknown): FinnhubApiError {
  if (error instanceof FinnhubApiError) return error;
  if (error instanceof Error) {
    return new FinnhubApiError(`Finnhub request failed: ${error.message}`, 503);
  }
  return new FinnhubApiError("Finnhub request failed: unknown error", 503);
}

export async function fetchFinnhubCandles(params: {
  apiKey: string;
  symbol: string;
  resolution: "1" | "5" | "15" | "30" | "60" | "240" | "D";
  from: Date;
  to: Date;
  timeoutMs?: number;
}): Promise<FinnhubNormalizedCandle[]> {
  const url = new URL("https://finnhub.io/api/v1/forex/candle");
  url.searchParams.set("symbol", normalizeSymbol(params.symbol));
  url.searchParams.set("resolution", params.resolution);
  url.searchParams.set("from", String(Math.floor(params.from.getTime() / 1000)));
  url.searchParams.set("to", String(Math.floor(params.to.getTime() / 1000)));
  url.searchParams.set("token", params.apiKey);

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
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new FinnhubApiError("Finnhub request timed out", 504);
    }
    throw error;
  }

  if (!response.ok) {
    throw new FinnhubApiError(
      `Finnhub HTTP ${response.status}: ${response.statusText}`,
      response.status,
    );
  }

  const payload = await response.json() as FinnhubCandleResponse;
  if (payload?.s === "no_data") {
    return [];
  }
  if (payload?.s && payload.s !== "ok") {
    throw new FinnhubApiError(`Finnhub error: ${payload.error ?? payload.s}`, 502);
  }

  return normalizeCandles(payload);
}

export async function fetchFinnhubCandlesWithRetry(params: {
  apiKey: string;
  symbol: string;
  resolution: "1" | "5" | "15" | "30" | "60" | "240" | "D";
  from: Date;
  to: Date;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): Promise<FinnhubNormalizedCandle[]> {
  const maxRetries = Math.max(0, Math.trunc(params.maxRetries ?? 3));
  const baseDelayMs = Math.max(100, Math.trunc(params.baseDelayMs ?? 500));
  const maxDelayMs = Math.max(baseDelayMs, Math.trunc(params.maxDelayMs ?? 5_000));

  let attempt = 0;
  while (true) {
    try {
      return await fetchFinnhubCandles({
        apiKey: params.apiKey,
        symbol: params.symbol,
        resolution: params.resolution,
        from: params.from,
        to: params.to,
        timeoutMs: params.timeoutMs,
      });
    } catch (error) {
      const normalized = toRetryableError(error);
      const canRetry = attempt < maxRetries && isRetryableStatus(normalized.statusCode);
      if (!canRetry) {
        throw normalized;
      }

      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
      const jitter = Math.floor(Math.random() * Math.max(100, Math.floor(baseDelayMs * 0.2)));
      await sleep(exponential + jitter);
      attempt += 1;
    }
  }
}
