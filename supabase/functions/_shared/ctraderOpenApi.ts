import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const PAYLOAD = {
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  NEW_ORDER_REQ: 2106,
  AMEND_POSITION_SLTP_REQ: 2110,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  RECONCILE_REQ: 2124,
  RECONCILE_RES: 2125,
  EXECUTION_EVENT: 2126,
  ORDER_ERROR_EVENT: 2132,
  ERROR_RES: 2142,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  REFRESH_TOKEN_REQ: 2173,
  REFRESH_TOKEN_RES: 2174,
} as const;

type IntentStatus =
  | "pending"
  | "sent"
  | "acknowledged"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected"
  | "error";

export interface CTraderExecutionIntent {
  id: number;
  symbol: string;
  direction: "long" | "short";
  planned_size_units: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
}

export interface CTraderExecutionResult {
  finalStatus: IntentStatus;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  message: string;
  retryable: boolean;
  payload: Record<string, unknown>;
}

export interface CTraderPositionSnapshot {
  broker_position_id: string;
  symbol: string;
  direction: "long" | "short";
  quantity: number | null;
  avg_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: "open" | "closed" | "cancelled";
  payload: Record<string, unknown>;
}

interface OAuthTokenRow {
  id: number;
  provider: string;
  connection_key: string;
  access_token: string;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  raw_response: Record<string, unknown> | null;
}

interface AccountRef {
  ctidTraderAccountId: number;
  isLive: boolean | null;
  traderLogin: number | null;
}

interface CTraderMessageEnvelope {
  clientMsgId: string | null;
  payloadType: number;
  payload: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: CTraderMessageEnvelope) => void;
  reject: (error: Error) => void;
  timeout: number;
}

interface Waiter {
  resolve: (value: CTraderMessageEnvelope) => void;
  reject: (error: Error) => void;
  timeout: number;
  predicate: (msg: CTraderMessageEnvelope) => boolean;
}

function parseInteger(
  value: unknown,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function symbolKey(value: unknown): string {
  return normalizeSymbol(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeConnectionKey(value: string | null | undefined): string {
  const cleaned = (value ?? "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "default";
}

function normalizeEnvironment(value: string | null | undefined): "live" | "demo" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "demo") return "demo";
  return "live";
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function currentIso(): string {
  return new Date().toISOString();
}

function parseCTraderError(message: CTraderMessageEnvelope): string {
  const payload = message.payload;
  const parts = [
    safeString(payload.errorCode ?? "").trim(),
    safeString(payload.description ?? "").trim(),
  ].filter((part) => part.length > 0);

  return parts.length > 0
    ? parts.join(": ")
    : `cTrader error payloadType=${message.payloadType}`;
}

function buildWsUrl(environment: "live" | "demo"): string {
  const explicit = (Deno.env.get("CTRADER_OPENAPI_WS_URL") ?? "").trim();
  if (explicit) return explicit;

  const host = environment === "demo" ? "demo.ctraderapi.com" : "live.ctraderapi.com";
  const port = parseInteger(Deno.env.get("CTRADER_OPENAPI_PORT"), 5036, 1, 65535);
  return `wss://${host}:${port}`;
}

function mapExecutionTypeToStatus(executionType: number): IntentStatus {
  switch (executionType) {
    case 2:
      return "acknowledged"; // ORDER_ACCEPTED
    case 3:
      return "filled"; // ORDER_FILLED
    case 4:
      return "acknowledged"; // ORDER_REPLACED
    case 5:
    case 6:
      return "cancelled"; // ORDER_CANCELLED / ORDER_EXPIRED
    case 7:
    case 8:
      return "rejected"; // ORDER_REJECTED / ORDER_CANCEL_REJECTED
    case 11:
      return "partially_filled"; // ORDER_PARTIAL_FILL
    default:
      return "acknowledged";
  }
}

function mapPositionStatus(statusValue: number | null): "open" | "closed" | "cancelled" {
  if (statusValue === 2) return "closed";
  if (statusValue === 4) return "cancelled";
  return "open";
}

function normalizeCTraderVolumeFromUnits(units: number): number {
  const multiplier = parseInteger(
    Deno.env.get("CTRADER_VOLUME_UNITS_MULTIPLIER"),
    100,
    1,
    1_000_000_000,
  );
  const step = parseInteger(
    Deno.env.get("CTRADER_VOLUME_STEP"),
    100,
    1,
    1_000_000_000,
  );
  const minVolume = parseInteger(
    Deno.env.get("CTRADER_MIN_VOLUME"),
    step,
    1,
    1_000_000_000,
  );
  const maxVolume = parseInteger(
    Deno.env.get("CTRADER_MAX_VOLUME"),
    2_000_000_000,
    minVolume,
    2_000_000_000,
  );

  const rawVolume = Math.round(Math.max(0, units) * multiplier);
  const stepped = Math.round(rawVolume / step) * step;
  const clamped = Math.min(maxVolume, Math.max(minVolume, stepped));
  return clamped;
}

class CTraderWsClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly waiters = new Set<Waiter>();
  private readonly backlog: CTraderMessageEnvelope[] = [];
  private closed = false;
  private nonJsonFrames = 0;

  constructor(
    private readonly url: string,
    private readonly requestTimeoutMs: number,
  ) {}

  async connect(): Promise<void> {
    if (this.ws) return;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          // no-op
        }
        reject(new Error(`Timed out connecting to cTrader websocket: ${this.url}`));
      }, this.requestTimeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ws = ws;
        this.closed = false;
        resolve();
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed opening cTrader websocket: ${this.url}`));
      };

      ws.onclose = () => {
        this.closed = true;
        this.failAll(new Error("cTrader websocket connection closed"));
      };

      ws.onmessage = async (event) => {
        const text = typeof event.data === "string"
          ? event.data
          : event.data instanceof Blob
          ? await event.data.text()
          : event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(new Uint8Array(event.data))
          : ArrayBuffer.isView(event.data)
          ? new TextDecoder().decode(
            new Uint8Array(
              event.data.buffer,
              event.data.byteOffset,
              event.data.byteLength,
            ),
          )
          : String(event.data ?? "");

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          this.nonJsonFrames += 1;
          if (this.nonJsonFrames >= 2) {
            this.failAll(
              new Error(
                "Received non-JSON cTrader websocket frames. This runtime expects JSON envelopes; configure bridge mode if your endpoint uses protobuf/binary OpenAPI transport.",
              ),
            );
            try {
              ws.close();
            } catch {
              // no-op
            }
          }
          return;
        }
        this.nonJsonFrames = 0;

        const obj = toObject(parsed);
        const payloadType = toFiniteNumber(obj.payloadType);
        if (!payloadType) return;

        const envelope: CTraderMessageEnvelope = {
          clientMsgId: typeof obj.clientMsgId === "string" ? obj.clientMsgId : null,
          payloadType,
          payload: toObject(obj.payload),
          raw: obj,
        };

        this.backlog.push(envelope);
        if (this.backlog.length > 500) {
          this.backlog.shift();
        }

        if (envelope.clientMsgId && this.pending.has(envelope.clientMsgId)) {
          const pending = this.pending.get(envelope.clientMsgId)!;
          this.pending.delete(envelope.clientMsgId);
          clearTimeout(pending.timeout);

          if (envelope.payloadType === PAYLOAD.ERROR_RES) {
            pending.reject(new Error(parseCTraderError(envelope)));
          } else {
            pending.resolve(envelope);
          }
        }

        for (const waiter of [...this.waiters]) {
          let matched = false;
          try {
            matched = waiter.predicate(envelope);
          } catch {
            matched = false;
          }

          if (matched) {
            this.waiters.delete(waiter);
            clearTimeout(waiter.timeout);
            waiter.resolve(envelope);
          }
        }
      };
    });
  }

  async send(payloadType: number, payload: Record<string, unknown>, clientMsgId?: string): Promise<string> {
    if (!this.ws || this.closed) {
      throw new Error("cTrader websocket is not connected");
    }
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("cTrader websocket is not open");
    }

    const msgId = clientMsgId ?? `ctr-${crypto.randomUUID()}`;
    this.ws.send(JSON.stringify({
      clientMsgId: msgId,
      payloadType,
      payload,
    }));
    return msgId;
  }

  async request(
    payloadType: number,
    payload: Record<string, unknown>,
    expectedPayloadTypes: number[],
  ): Promise<CTraderMessageEnvelope> {
    const msgId = `ctr-${crypto.randomUUID()}`;
    const responsePromise = new Promise<CTraderMessageEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error(`Timed out waiting cTrader response for payloadType=${payloadType}`));
      }, this.requestTimeoutMs);

      this.pending.set(msgId, {
        resolve,
        reject,
        timeout,
      });
    });

    try {
      await this.send(payloadType, payload, msgId);
    } catch (error) {
      const pending = this.pending.get(msgId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(msgId);
      }
      throw error;
    }

    const response = await responsePromise;

    if (expectedPayloadTypes.length > 0 && !expectedPayloadTypes.includes(response.payloadType)) {
      throw new Error(
        `Unexpected cTrader payloadType=${response.payloadType}, expected one of ${expectedPayloadTypes.join(",")}`,
      );
    }

    return response;
  }

  async waitFor(
    predicate: (msg: CTraderMessageEnvelope) => boolean,
    timeoutMs: number,
  ): Promise<CTraderMessageEnvelope> {
    for (let i = this.backlog.length - 1; i >= 0; i -= 1) {
      const msg = this.backlog[i];
      let matched = false;
      try {
        matched = predicate(msg);
      } catch {
        matched = false;
      }
      if (matched) {
        return msg;
      }
    }

    return await new Promise<CTraderMessageEnvelope>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        predicate,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error("Timed out waiting cTrader event"));
        }, timeoutMs),
      };

      this.waiters.add(waiter);
    });
  }

  close(): void {
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // no-op
      }
      this.ws = null;
    }
    this.failAll(new Error("cTrader websocket client closed"));
  }

  private failAll(error: Error): void {
    for (const [id, pending] of [...this.pending]) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }

    for (const waiter of [...this.waiters]) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
      this.waiters.delete(waiter);
    }
  }
}

export class CTraderOpenApiRuntime {
  private client: CTraderWsClient | null = null;
  private token: OAuthTokenRow | null = null;
  private account: AccountRef | null = null;
  private symbolsByName = new Map<string, number>();
  private symbolsById = new Map<number, string>();
  private initialized = false;

  private constructor(
    private readonly supabase: SupabaseClient,
    private readonly traceId: string,
    private readonly connectionKey: string,
  ) {}

  static async create(params: {
    supabase: SupabaseClient;
    traceId: string;
    connectionKey?: string | null;
  }): Promise<CTraderOpenApiRuntime> {
    const connectionKey = normalizeConnectionKey(
      params.connectionKey ?? Deno.env.get("CTRADER_OAUTH_DEFAULT_CONNECTION_KEY") ?? "default",
    );

    const runtime = new CTraderOpenApiRuntime(
      params.supabase,
      params.traceId,
      connectionKey,
    );
    await runtime.init();
    return runtime;
  }

  async placeOrder(intent: CTraderExecutionIntent): Promise<CTraderExecutionResult> {
    await this.init();
    if (!this.client || !this.account) {
      throw new Error("cTrader runtime is not initialised");
    }

    const symbolName = normalizeSymbol(intent.symbol);
    const symbolLookupCandidates = [
      symbolName,
      symbolKey(symbolName),
    ].filter((value, idx, arr) => value.length > 0 && arr.indexOf(value) === idx);

    let resolvedSymbolId: number | null = null;
    for (const key of symbolLookupCandidates) {
      const candidate = this.symbolsByName.get(key);
      if (candidate) {
        resolvedSymbolId = candidate;
        break;
      }
    }

    if (!resolvedSymbolId) {
      await this.reloadSymbols();
    }

    if (!resolvedSymbolId) {
      for (const key of symbolLookupCandidates) {
        const candidate = this.symbolsByName.get(key);
        if (candidate) {
          resolvedSymbolId = candidate;
          break;
        }
      }
    }

    if (!resolvedSymbolId) {
      throw new Error(`Symbol '${symbolName}' not found in cTrader symbols list for account ${this.account.ctidTraderAccountId}`);
    }

    const direction = intent.direction === "short" ? 2 : 1; // SELL/BUY
    const defaultUnits = parseInteger(Deno.env.get("CTRADER_DEFAULT_VOLUME_UNITS"), 10_000, 1, 10_000_000_000);
    const units = toFiniteNumber(intent.planned_size_units) ?? defaultUnits;
    const volume = normalizeCTraderVolumeFromUnits(units);

    const label = `intent-${intent.id}`.slice(0, 100);
    const clientOrderId = `broker-intent-${intent.id}`.slice(0, 50);

    await this.client.send(PAYLOAD.NEW_ORDER_REQ, {
      ctidTraderAccountId: this.account.ctidTraderAccountId,
      symbolId: resolvedSymbolId,
      orderType: 1,
      tradeSide: direction,
      volume,
      label,
      clientOrderId,
    });

    const eventTimeoutMs = parseInteger(
      Deno.env.get("CTRADER_ORDER_EVENT_TIMEOUT_MS"),
      20_000,
      2_000,
      120_000,
    );

    const event = await this.client.waitFor((msg) => {
      if (msg.payloadType !== PAYLOAD.EXECUTION_EVENT && msg.payloadType !== PAYLOAD.ORDER_ERROR_EVENT) {
        return false;
      }

      const payload = msg.payload;
      const accountId = toFiniteNumber(payload.ctidTraderAccountId);
      if (!accountId || accountId !== this.account!.ctidTraderAccountId) {
        return false;
      }

      const order = toObject(payload.order);
      const tradeData = toObject(order.tradeData);
      const eventLabel = safeString(tradeData.label ?? order.label ?? "").trim();
      const eventClientOrderId = safeString(order.clientOrderId ?? "").trim();

      return eventLabel === label || eventClientOrderId === clientOrderId;
    }, eventTimeoutMs);

    if (event.payloadType === PAYLOAD.ORDER_ERROR_EVENT) {
      const errorMessage = [
        safeString(event.payload.errorCode ?? "").trim(),
        safeString(event.payload.description ?? "").trim(),
      ].filter((part) => part.length > 0).join(": ") || "Order rejected by cTrader";

      return {
        finalStatus: "rejected",
        brokerOrderId: null,
        brokerPositionId: null,
        message: errorMessage,
        retryable: false,
        payload: {
          event: event.raw,
        },
      };
    }

    const executionType = toFiniteNumber(event.payload.executionType) ?? 2;
    const status = mapExecutionTypeToStatus(executionType);
    const orderObj = toObject(event.payload.order);
    const positionObj = toObject(event.payload.position);
    const brokerOrderId = safeString(orderObj.orderId ?? "").trim() || null;
    const positionId = toFiniteNumber(
      positionObj.positionId ?? orderObj.positionId,
    );
    const brokerPositionId = positionId !== null ? String(Math.trunc(positionId)) : null;

    const stopLoss = toFiniteNumber(intent.stop_loss);
    const takeProfit = toFiniteNumber(intent.tp3);

    let protectionAmend: Record<string, unknown> | null = null;
    if (positionId && (stopLoss !== null || takeProfit !== null)) {
      try {
        await this.client.send(PAYLOAD.AMEND_POSITION_SLTP_REQ, {
          ctidTraderAccountId: this.account.ctidTraderAccountId,
          positionId,
          ...(stopLoss !== null ? { stopLoss } : {}),
          ...(takeProfit !== null ? { takeProfit } : {}),
        });

        const amendEvent = await this.client.waitFor((msg) => {
          if (msg.payloadType !== PAYLOAD.EXECUTION_EVENT && msg.payloadType !== PAYLOAD.ORDER_ERROR_EVENT) {
            return false;
          }
          const payload = msg.payload;
          const accountId = toFiniteNumber(payload.ctidTraderAccountId);
          if (!accountId || accountId !== this.account!.ctidTraderAccountId) {
            return false;
          }

          const pos = toObject(payload.position);
          const posId = toFiniteNumber(pos.positionId);
          return posId === positionId;
        }, Math.min(eventTimeoutMs, 10_000));

        protectionAmend = {
          ok: amendEvent.payloadType === PAYLOAD.EXECUTION_EVENT,
          payload: amendEvent.raw,
        };
      } catch (error) {
        protectionAmend = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      finalStatus: status,
      brokerOrderId,
      brokerPositionId,
      message: `cTrader execution type ${executionType}`,
      retryable: status === "pending" || status === "acknowledged",
      payload: {
        execution_event: event.raw,
        position_id: positionId,
        label,
        client_order_id: clientOrderId,
        protection_amend: protectionAmend,
      },
    };
  }

  async listPositions(params?: {
    onlyOpen?: boolean;
    limit?: number;
  }): Promise<CTraderPositionSnapshot[]> {
    await this.init();
    if (!this.client || !this.account) {
      throw new Error("cTrader runtime is not initialised");
    }

    const onlyOpen = params?.onlyOpen ?? true;
    const limit = params?.limit ?? 150;

    const reconcileRes = await this.client.request(
      PAYLOAD.RECONCILE_REQ,
      {
        ctidTraderAccountId: this.account.ctidTraderAccountId,
        returnProtectionOrders: true,
      },
      [PAYLOAD.RECONCILE_RES],
    );

    const payload = reconcileRes.payload;
    const positions = Array.isArray(payload.position) ? payload.position : [];

    const rows: CTraderPositionSnapshot[] = [];
    for (const row of positions) {
      const pos = toObject(row);
      const tradeData = toObject(pos.tradeData);
      const symbolId = toFiniteNumber(tradeData.symbolId);
      const symbolName = symbolId ? this.symbolsById.get(symbolId) ?? `SYMBOL_ID_${symbolId}` : "UNKNOWN";
      const tradeSide = toFiniteNumber(tradeData.tradeSide);
      const direction = tradeSide === 2 ? "short" : "long";
      const positionStatusValue = toFiniteNumber(pos.positionStatus);
      const status = mapPositionStatus(positionStatusValue);

      if (onlyOpen && status !== "open") {
        continue;
      }

      const volumeCents = toFiniteNumber(tradeData.volume);
      const quantity = volumeCents !== null ? volumeCents / 100 : null;
      const positionId = safeString(pos.positionId ?? "").trim();
      if (!positionId) continue;

      rows.push({
        broker_position_id: positionId,
        symbol: symbolName,
        direction,
        quantity,
        avg_price: toFiniteNumber(pos.price),
        stop_loss: toFiniteNumber(pos.stopLoss),
        take_profit: toFiniteNumber(pos.takeProfit),
        status,
        payload: pos,
      });

      if (rows.length >= limit) {
        break;
      }
    }

    return rows;
  }

  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.token = await this.loadToken();
    await this.connectAndAuthorize();
    await this.reloadSymbols();
    this.initialized = true;
  }

  private async loadToken(): Promise<OAuthTokenRow> {
    const { data, error } = await this.supabase
      .from("broker_oauth_tokens")
      .select(
        "id,provider,connection_key,access_token,refresh_token,access_token_expires_at,raw_response",
      )
      .eq("provider", "ctrader")
      .eq("connection_key", this.connectionKey)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed loading cTrader OAuth token: ${error.message}`);
    }

    if (!data) {
      throw new Error(
        `No active cTrader OAuth token found for connection_key='${this.connectionKey}' (trace_id=${this.traceId}). Run ctrader-oauth-callback flow first.`,
      );
    }

    const row = data as OAuthTokenRow;
    const expiryMs = row.access_token_expires_at
      ? Date.parse(row.access_token_expires_at)
      : NaN;

    if (Number.isFinite(expiryMs) && expiryMs <= Date.now() + 60_000) {
      return await this.refreshToken(row);
    }

    return row;
  }

  private async refreshToken(row: OAuthTokenRow): Promise<OAuthTokenRow> {
    if (!row.refresh_token) {
      return row;
    }

    const environment = normalizeEnvironment(Deno.env.get("CTRADER_OPENAPI_ENV"));
    const url = buildWsUrl(environment);
    const timeoutMs = parseInteger(Deno.env.get("CTRADER_OPENAPI_TIMEOUT_MS"), 20_000, 2_000, 120_000);

    const refreshClient = new CTraderWsClient(url, timeoutMs);
    await refreshClient.connect();

    try {
      const clientId = (Deno.env.get("CTRADER_CLIENT_ID") ?? "").trim();
      const clientSecret = (Deno.env.get("CTRADER_CLIENT_SECRET") ?? "").trim();
      if (!clientId || !clientSecret) {
        throw new Error("CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET are required");
      }

      await refreshClient.request(
        PAYLOAD.APPLICATION_AUTH_REQ,
        {
          clientId,
          clientSecret,
        },
        [PAYLOAD.APPLICATION_AUTH_RES],
      );

      const refreshRes = await refreshClient.request(
        PAYLOAD.REFRESH_TOKEN_REQ,
        {
          refreshToken: row.refresh_token,
        },
        [PAYLOAD.REFRESH_TOKEN_RES],
      );

      const tokenPayload = refreshRes.payload;
      const newAccessToken = safeString(tokenPayload.accessToken ?? "").trim();
      const newRefreshToken = safeString(tokenPayload.refreshToken ?? "").trim() || row.refresh_token;
      const expiresIn = parseInteger(tokenPayload.expiresIn, 0, 0, 60 * 60 * 24 * 30);
      const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

      if (!newAccessToken) {
        throw new Error("cTrader refresh token response did not include accessToken");
      }

      const { data: updated, error: updateError } = await this.supabase
        .from("broker_oauth_tokens")
        .update({
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          expires_in_seconds: expiresIn > 0 ? expiresIn : null,
          access_token_expires_at: expiresAt,
          last_refreshed_at: currentIso(),
          updated_at: currentIso(),
          raw_response: tokenPayload,
        })
        .eq("id", row.id)
        .select(
          "id,provider,connection_key,access_token,refresh_token,access_token_expires_at,raw_response",
        )
        .single();

      if (updateError || !updated) {
        throw new Error(`Failed updating refreshed cTrader token: ${updateError?.message ?? "unknown"}`);
      }

      return updated as OAuthTokenRow;
    } finally {
      refreshClient.close();
    }
  }

  private async connectAndAuthorize(): Promise<void> {
    if (!this.token) {
      throw new Error("OAuth token must be loaded before cTrader auth");
    }

    const environment = normalizeEnvironment(Deno.env.get("CTRADER_OPENAPI_ENV"));
    const url = buildWsUrl(environment);
    const timeoutMs = parseInteger(Deno.env.get("CTRADER_OPENAPI_TIMEOUT_MS"), 20_000, 2_000, 120_000);

    this.client = new CTraderWsClient(url, timeoutMs);
    await this.client.connect();

    const clientId = (Deno.env.get("CTRADER_CLIENT_ID") ?? "").trim();
    const clientSecret = (Deno.env.get("CTRADER_CLIENT_SECRET") ?? "").trim();
    if (!clientId || !clientSecret) {
      throw new Error("CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET are required");
    }

    await this.client.request(
      PAYLOAD.APPLICATION_AUTH_REQ,
      {
        clientId,
        clientSecret,
      },
      [PAYLOAD.APPLICATION_AUTH_RES],
    );

    const accountListRes = await this.client.request(
      PAYLOAD.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      {
        accessToken: this.token.access_token,
      },
      [PAYLOAD.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES],
    );

    const accountPayload = accountListRes.payload;
    const accountsRaw = Array.isArray(accountPayload.ctidTraderAccount)
      ? accountPayload.ctidTraderAccount
      : [];

    const accounts: AccountRef[] = accountsRaw
      .map((item) => {
        const obj = toObject(item);
        const id = toFiniteNumber(obj.ctidTraderAccountId);
        if (!id) return null;
        return {
          ctidTraderAccountId: id,
          isLive: typeof obj.isLive === "boolean" ? obj.isLive : null,
          traderLogin: toFiniteNumber(obj.traderLogin),
        } as AccountRef;
      })
      .filter((item): item is AccountRef => item !== null);

    if (accounts.length === 0) {
      throw new Error("cTrader token has no granted trader accounts");
    }

    const configuredAccountId = toFiniteNumber(Deno.env.get("CTRADER_TARGET_ACCOUNT_ID"));
    const desiredLive = normalizeEnvironment(Deno.env.get("CTRADER_OPENAPI_ENV")) === "live";

    let selected = accounts.find((acc) => configuredAccountId !== null && acc.ctidTraderAccountId === configuredAccountId) ?? null;
    if (!selected) {
      selected = accounts.find((acc) => acc.isLive === desiredLive) ?? accounts[0];
    }

    this.account = selected;

    await this.client.request(
      PAYLOAD.ACCOUNT_AUTH_REQ,
      {
        ctidTraderAccountId: selected.ctidTraderAccountId,
        accessToken: this.token.access_token,
      },
      [PAYLOAD.ACCOUNT_AUTH_RES],
    );

    // Pull trader snapshot once to validate account auth and enrich traces.
    await this.client.request(
      PAYLOAD.TRADER_REQ,
      {
        ctidTraderAccountId: selected.ctidTraderAccountId,
      },
      [PAYLOAD.TRADER_RES],
    );
  }

  private async reloadSymbols(): Promise<void> {
    if (!this.client || !this.account) {
      throw new Error("Cannot load symbols before cTrader account auth");
    }

    const symbolsRes = await this.client.request(
      PAYLOAD.SYMBOLS_LIST_REQ,
      {
        ctidTraderAccountId: this.account.ctidTraderAccountId,
        includeArchivedSymbols: false,
      },
      [PAYLOAD.SYMBOLS_LIST_RES],
    );

    const payload = symbolsRes.payload;
    const rows = Array.isArray(payload.symbol) ? payload.symbol : [];

    this.symbolsByName = new Map();
    this.symbolsById = new Map();

    for (const row of rows) {
      const obj = toObject(row);
      const symbolId = toFiniteNumber(obj.symbolId);
      const symbolName = normalizeSymbol(obj.symbolName ?? obj.name);
      if (!symbolId || !symbolName) continue;

      this.symbolsByName.set(symbolName, symbolId);
      const compact = symbolKey(symbolName);
      if (compact.length > 0) {
        this.symbolsByName.set(compact, symbolId);
      }
      this.symbolsById.set(symbolId, symbolName);
    }

    if (this.symbolsByName.size === 0) {
      throw new Error(
        `cTrader symbols list is empty for account ${this.account.ctidTraderAccountId}`,
      );
    }
  }
}
