import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  finishOpsFunctionRun,
  insertOpsAlert,
  startOpsFunctionRun,
} from "../_shared/ops.ts";
import { createSupabaseAdminClient } from "../_shared/supabaseAdmin.ts";

interface ParsedState {
  raw: string;
  connectionKey: string | null;
  decoded: Record<string, unknown> | null;
}

interface OAuthStatePayload {
  v: 1;
  connection_key: string;
  nonce: string;
  iat: number;
  exp: number;
}

function parseInteger(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function sanitizeConnectionKey(value: string | null | undefined, fallback = "default"): string {
  const candidate = (value ?? "").trim();
  if (!candidate) return fallback;

  const cleaned = candidate.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : fallback;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function extractAcceptsJson(req: Request): boolean {
  const accept = req.headers.get("accept")?.toLowerCase() ?? "";
  return accept.includes("application/json") || accept.includes("text/json");
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = atob(normalized + padding);
    const bytes = Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function parseState(rawState: string | null): ParsedState {
  const raw = (rawState ?? "").trim();
  if (!raw) {
    return { raw: "", connectionKey: null, decoded: null };
  }

  const decodeAsJson = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = decodeAsJson(raw);
  if (direct) {
    return {
      raw,
      connectionKey: sanitizeConnectionKey(
        String(direct.connection_key ?? direct.connectionKey ?? ""),
        "default",
      ),
      decoded: direct,
    };
  }

  const decodedText = base64UrlDecode(raw);
  if (decodedText) {
    const decodedObj = decodeAsJson(decodedText);
    if (decodedObj) {
      return {
        raw,
        connectionKey: sanitizeConnectionKey(
          String(decodedObj.connection_key ?? decodedObj.connectionKey ?? ""),
          "default",
        ),
        decoded: decodedObj,
      };
    }
  }

  if (/^[a-zA-Z0-9:_-]{1,64}$/.test(raw)) {
    return {
      raw,
      connectionKey: sanitizeConnectionKey(raw, "default"),
      decoded: null,
    };
  }

  return {
    raw,
    connectionKey: null,
    decoded: null,
  };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalizeStatePayload(payload: OAuthStatePayload): string {
  return JSON.stringify({
    v: payload.v,
    connection_key: payload.connection_key,
    nonce: payload.nonce,
    iat: payload.iat,
    exp: payload.exp,
  });
}

async function buildSignedState(params: {
  connectionKey: string;
  secret: string;
  ttlSeconds: number;
}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: OAuthStatePayload = {
    v: 1,
    connection_key: params.connectionKey,
    nonce: crypto.randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + Math.max(60, params.ttlSeconds),
  };
  const canonical = canonicalizeStatePayload(payload);
  const sig = await hmacSha256Hex(params.secret, canonical);
  return base64UrlEncode(JSON.stringify({ ...payload, sig }));
}

async function verifySignedState(params: {
  raw: string;
  secret: string;
}): Promise<{ valid: boolean; reason: string; payload: OAuthStatePayload | null }> {
  const parsed = parseState(params.raw);
  const decoded = parsed.decoded ?? {};

  const connectionKey = sanitizeConnectionKey(
    String(decoded.connection_key ?? decoded.connectionKey ?? ""),
    "",
  );
  const nonce = String(decoded.nonce ?? "").trim();
  const iat = parseInteger(decoded.iat, 0, 0, Number.MAX_SAFE_INTEGER);
  const exp = parseInteger(decoded.exp, 0, 0, Number.MAX_SAFE_INTEGER);
  const version = parseInteger(decoded.v, 0, 0, 100);
  const sig = String(decoded.sig ?? "").trim().toLowerCase();

  if (!connectionKey || !nonce || !iat || !exp || version !== 1 || !sig) {
    return { valid: false, reason: "state_missing_required_fields", payload: null };
  }

  const candidate: OAuthStatePayload = {
    v: 1,
    connection_key: connectionKey,
    nonce,
    iat,
    exp,
  };
  const canonical = canonicalizeStatePayload(candidate);
  const expectedSig = (await hmacSha256Hex(params.secret, canonical)).toLowerCase();
  if (expectedSig !== sig) {
    return { valid: false, reason: "state_signature_mismatch", payload: null };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp < nowSeconds) {
    return { valid: false, reason: "state_expired", payload: null };
  }

  return { valid: true, reason: "ok", payload: candidate };
}

function extractTokenString(responseObj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = responseObj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head><body style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;max-width:780px;margin:0 auto;"><h2>${title}</h2>${body}</body></html>`,
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

function deriveRedirectUri(reqUrl: URL): string {
  const configured = (Deno.env.get("CTRADER_OAUTH_REDIRECT_URI") ?? "").trim();
  if (configured) return configured;
  return `${reqUrl.origin}${reqUrl.pathname}`;
}

function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  product: string;
  state: string | null;
}): string {
  const base = (Deno.env.get("CTRADER_OAUTH_AUTHORIZE_URL") ??
    "https://id.ctrader.com/my/settings/openapi/grantingaccess/").trim();

  const url = new URL(base);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("product", params.product);
  if (params.state && params.state.trim().length > 0) {
    url.searchParams.set("state", params.state);
  }

  return url.toString();
}

async function fetchToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  timeoutMs: number;
}): Promise<{ responseObj: Record<string, unknown>; status: number }> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const res = await fetch(params.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw_text: text };
      }
    }

    const responseObj = toObject(parsed);

    if (!res.ok) {
      const message = String(
        responseObj.error_description ??
          responseObj.error ??
          responseObj.message ??
          `Token exchange failed (${res.status})`,
      );
      throw new Error(message);
    }

    return {
      responseObj,
      status: res.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const traceId = `ctrader-oauth-${crypto.randomUUID()}`;
  const startedAtMs = Date.now();
  const wantsJson = extractAcceptsJson(req);

  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;
  let runStatus: "success" | "failed" | "partial" = "failed";
  let runPayload: Record<string, unknown> = {};

  try {
    const reqUrl = new URL(req.url);
    const code = reqUrl.searchParams.get("code")?.trim() ?? "";
    const oauthError = reqUrl.searchParams.get("error")?.trim() ?? "";
    const oauthErrorDescription = reqUrl.searchParams.get("error_description")?.trim() ?? "";

    const clientId = (Deno.env.get("CTRADER_CLIENT_ID") ?? "").trim();
    const clientSecret = (Deno.env.get("CTRADER_CLIENT_SECRET") ?? "").trim();
    const redirectUri = deriveRedirectUri(reqUrl);
    const scope = (Deno.env.get("CTRADER_OAUTH_SCOPE") ?? "accounts").trim();
    const product = (Deno.env.get("CTRADER_OAUTH_PRODUCT") ?? "web").trim();
    const enforceState = parseBoolean(Deno.env.get("CTRADER_OAUTH_ENFORCE_STATE"), true);
    const allowLegacyState = parseBoolean(
      Deno.env.get("CTRADER_OAUTH_ALLOW_LEGACY_STATE"),
      false,
    );
    const stateTtlSeconds = parseInteger(
      Deno.env.get("CTRADER_OAUTH_STATE_TTL_SECONDS"),
      600,
      60,
      3600,
    );
    const stateSecret = (Deno.env.get("CTRADER_OAUTH_STATE_SECRET") ?? clientSecret).trim();

    if (!clientId) {
      throw new Error("Missing CTRADER_CLIENT_ID");
    }

    supabase = createSupabaseAdminClient();
    runId = await startOpsFunctionRun({
      supabase,
      functionName: "ctrader-oauth-callback",
      traceId,
      payload: {
        redirect_uri: redirectUri,
      },
    });

    const state = parseState(reqUrl.searchParams.get("state"));
    const requestedConnection = reqUrl.searchParams.get("connection_key")?.trim() ?? "";
    const defaultConnection = sanitizeConnectionKey(
      Deno.env.get("CTRADER_OAUTH_DEFAULT_CONNECTION_KEY")?.trim() ?? "default",
      "default",
    );
    let connectionKey = sanitizeConnectionKey(
      requestedConnection || state.connectionKey || defaultConnection,
      defaultConnection,
    );

    if (oauthError.length > 0) {
      const message = oauthErrorDescription || oauthError;
      runStatus = "failed";
      runPayload = {
        trace_id: traceId,
        error: message,
        provider: "ctrader",
      };

      const errorRedirect = (Deno.env.get("CTRADER_OAUTH_ERROR_REDIRECT_URL") ?? "").trim();
      if (errorRedirect.length > 0) {
        const target = new URL(errorRedirect);
        target.searchParams.set("status", "error");
        target.searchParams.set("provider", "ctrader");
        target.searchParams.set("message", message);
        target.searchParams.set("trace_id", traceId);
        return Response.redirect(target.toString(), 302);
      }

      if (wantsJson) {
        return jsonResponse({
          error: message,
          trace_id: traceId,
          provider: "ctrader",
        }, 400);
      }

      return htmlPage(
        "cTrader OAuth Error",
        `<p>Authorization failed: <b>${message}</b></p><p>Trace ID: <code>${traceId}</code></p>`,
      );
    }

    if (!code) {
      if (enforceState && !stateSecret) {
        throw new Error(
          "Missing CTRADER_OAUTH_STATE_SECRET (or CTRADER_CLIENT_SECRET) while CTRADER_OAUTH_ENFORCE_STATE=true",
        );
      }

      const generatedState = stateSecret
        ? await buildSignedState({
          connectionKey,
          secret: stateSecret,
          ttlSeconds: stateTtlSeconds,
        })
        : (state.raw || base64UrlEncode(JSON.stringify({
          connection_key: connectionKey,
          t: Date.now(),
        })));
      const authorizeUrl = buildAuthorizeUrl({
        clientId,
        redirectUri,
        scope,
        product,
        state: generatedState,
      });

      runStatus = "success";
      runPayload = {
        trace_id: traceId,
        mode: "authorize_url",
        provider: "ctrader",
      };

      const payload = {
        trace_id: traceId,
        provider: "ctrader",
        message: "Open authorize_url to connect cTrader account.",
        redirect_uri: redirectUri,
        authorize_url: authorizeUrl,
        connection_key: connectionKey,
      };

      if (wantsJson) {
        return jsonResponse(payload);
      }

      return htmlPage(
        "Connect cTrader",
        `<p>Click to start OAuth:</p><p><a href="${authorizeUrl}">${authorizeUrl}</a></p><p>Connection Key: <code>${connectionKey}</code></p>`,
      );
    }

    if (!clientSecret) {
      throw new Error("Missing CTRADER_CLIENT_SECRET");
    }

    if (enforceState) {
      if (!state.raw) {
        throw new Error("Missing OAuth state");
      }
      if (!stateSecret) {
        throw new Error("Missing CTRADER_OAUTH_STATE_SECRET for state verification");
      }

      const verifiedState = await verifySignedState({
        raw: state.raw,
        secret: stateSecret,
      });
      if (!verifiedState.valid || !verifiedState.payload) {
        if (allowLegacyState && state.connectionKey) {
          connectionKey = sanitizeConnectionKey(state.connectionKey, defaultConnection);
        } else {
          throw new Error(`Invalid OAuth state: ${verifiedState.reason}`);
        }
      } else {
        connectionKey = sanitizeConnectionKey(
          verifiedState.payload.connection_key,
          defaultConnection,
        );
      }
    }

    const tokenUrl = (Deno.env.get("CTRADER_OAUTH_TOKEN_URL") ??
      "https://openapi.ctrader.com/apps/token").trim();
    const timeoutMs = parseInteger(
      Deno.env.get("CTRADER_OAUTH_TIMEOUT_MS"),
      15_000,
      1_000,
      120_000,
    );

    const tokenResponse = await fetchToken({
      tokenUrl,
      clientId,
      clientSecret,
      redirectUri,
      code,
      timeoutMs,
    });

    const tokenObj = tokenResponse.responseObj;
    const accessToken = extractTokenString(tokenObj, ["accessToken", "access_token"]);
    const refreshToken = extractTokenString(tokenObj, ["refreshToken", "refresh_token"]);

    if (!accessToken) {
      throw new Error("Token exchange succeeded but access token missing in response");
    }

    const expiresIn = parseInteger(tokenObj.expiresIn ?? tokenObj.expires_in, 0, 0, 60 * 60 * 24 * 30);
    const now = new Date();
    const expiresAt = expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null;
    const ctraderAccountId = extractTokenString(tokenObj, ["ctid", "cTid", "user_id", "userId"]);
    const tokenType = extractTokenString(tokenObj, ["tokenType", "token_type"]);
    const scopeText = extractTokenString(tokenObj, ["scope"]);

    const upsertPayload = {
      provider: "ctrader",
      connection_key: connectionKey,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: tokenType,
      scope: scopeText,
      ctrader_account_id: ctraderAccountId,
      expires_in_seconds: expiresIn > 0 ? expiresIn : null,
      access_token_expires_at: expiresAt?.toISOString() ?? null,
      oauth_state: state.raw || null,
      status: "active",
      raw_response: tokenObj,
      last_refreshed_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const { data: savedToken, error: saveError } = await supabase
      .from("broker_oauth_tokens")
      .upsert(upsertPayload, { onConflict: "provider,connection_key" })
      .select("id,provider,connection_key,ctrader_account_id,access_token_expires_at,updated_at")
      .single();

    if (saveError) {
      throw new Error(`Failed saving cTrader token: ${saveError.message}`);
    }

    const successPayload = {
      trace_id: traceId,
      provider: "ctrader",
      connection_key: connectionKey,
      token_saved: true,
      token_row: savedToken,
      token_response_status: tokenResponse.status,
    };

    runStatus = "success";
    runPayload = successPayload;

    const successRedirect = (Deno.env.get("CTRADER_OAUTH_SUCCESS_REDIRECT_URL") ?? "").trim();
    if (successRedirect.length > 0) {
      const target = new URL(successRedirect);
      target.searchParams.set("status", "ok");
      target.searchParams.set("provider", "ctrader");
      target.searchParams.set("connection_key", connectionKey);
      target.searchParams.set("trace_id", traceId);
      return Response.redirect(target.toString(), 302);
    }

    if (wantsJson) {
      return jsonResponse(successPayload);
    }

    return htmlPage(
      "cTrader Connected",
      `<p>Token saved successfully for provider <b>ctrader</b>.</p><p>Connection Key: <code>${connectionKey}</code></p><p>Trace ID: <code>${traceId}</code></p>`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runStatus = "failed";
    runPayload = {
      trace_id: traceId,
      error: errorMessage,
    };

    if (supabase) {
      await insertOpsAlert({
        supabase,
        traceId,
        alertType: "ctrader_oauth_callback_failed",
        severity: "error",
        message: "cTrader OAuth callback failed",
        payload: {
          error: errorMessage,
        },
      });
    }

    const errorRedirect = (Deno.env.get("CTRADER_OAUTH_ERROR_REDIRECT_URL") ?? "").trim();
    if (errorRedirect.length > 0) {
      const target = new URL(errorRedirect);
      target.searchParams.set("status", "error");
      target.searchParams.set("provider", "ctrader");
      target.searchParams.set("message", errorMessage);
      target.searchParams.set("trace_id", traceId);
      return Response.redirect(target.toString(), 302);
    }

    if (wantsJson) {
      return jsonResponse({ error: errorMessage, trace_id: traceId }, 500);
    }

    return htmlPage(
      "cTrader OAuth Failed",
      `<p>${errorMessage}</p><p>Trace ID: <code>${traceId}</code></p>`,
    );
  } finally {
    if (supabase) {
      await finishOpsFunctionRun({
        supabase,
        runId,
        status: runStatus,
        startedAtMs,
        payload: runPayload,
      });
    }
  }
});
