import { jsonResponse } from "./http.ts";

interface EnforceSecretAuthParams {
  req: Request;
  secretEnvNames: string[];
  includeServiceRoleKey?: boolean;
  extraHeaderNames?: string[];
  requireAuthEnvName?: string;
  requireAuthByDefault?: boolean;
  scope?: string;
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeSecret(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLength = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLength; i += 1) {
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }

  return diff === 0;
}

export function extractBearerToken(value: string | null): string {
  if (!value) return "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return normalizeSecret(match?.[1] ?? "");
}

export function isAuthorizedByAnySecret(params: {
  req: Request;
  acceptedSecrets: string[];
  extraHeaderNames?: string[];
}): boolean {
  const secrets = params.acceptedSecrets
    .map(normalizeSecret)
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
  if (secrets.length === 0) return false;

  const headerValues: string[] = [
    normalizeSecret(params.req.headers.get("x-cron-secret")),
    normalizeSecret(params.req.headers.get("x-callback-secret")),
    normalizeSecret(params.req.headers.get("x-ctrader-secret")),
    normalizeSecret(params.req.headers.get("x-broker-secret")),
    normalizeSecret(params.req.headers.get("apikey")),
    extractBearerToken(params.req.headers.get("authorization")),
  ];

  for (const headerName of params.extraHeaderNames ?? []) {
    const value = normalizeSecret(params.req.headers.get(headerName));
    if (value.length > 0) {
      headerValues.push(value);
    }
  }

  for (const provided of headerValues) {
    if (!provided) continue;
    for (const expected of secrets) {
      if (timingSafeEqual(provided, expected)) {
        return true;
      }
    }
  }

  return false;
}

export function enforceSecretAuth(params: EnforceSecretAuthParams): Response | null {
  const requireAuth = parseBoolean(
    Deno.env.get(params.requireAuthEnvName ?? "REQUIRE_INTERNAL_AUTH"),
    params.requireAuthByDefault ?? true,
  );

  const acceptedSecrets = params.secretEnvNames
    .map((name) => normalizeSecret(Deno.env.get(name)))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);

  if (params.includeServiceRoleKey ?? true) {
    const serviceRoleKey = normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (serviceRoleKey.length > 0 && !acceptedSecrets.includes(serviceRoleKey)) {
      acceptedSecrets.push(serviceRoleKey);
    }
  }

  if (!requireAuth && acceptedSecrets.length === 0) {
    return null;
  }

  if (acceptedSecrets.length === 0) {
    const scope = params.scope ?? "function";
    const expected = params.secretEnvNames.join(" or ");
    return jsonResponse(
      {
        error: `Server misconfigured: auth secret is required for ${scope}.`,
        expected_env: expected,
      },
      503,
    );
  }

  const authorized = isAuthorizedByAnySecret({
    req: params.req,
    acceptedSecrets,
    extraHeaderNames: params.extraHeaderNames,
  });

  if (!authorized) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}
