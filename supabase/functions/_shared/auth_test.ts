import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractBearerToken,
  isAuthorizedByAnySecret,
  parseBoolean,
} from "./auth.ts";

Deno.test("parseBoolean handles common truthy and falsy inputs", () => {
  assert(parseBoolean(true, false));
  assert(parseBoolean("true", false));
  assert(parseBoolean("YES", false));
  assertFalse(parseBoolean(false, true));
  assertFalse(parseBoolean("off", true));
  assertEquals(parseBoolean("unexpected", true), true);
  assertEquals(parseBoolean("unexpected", false), false);
});

Deno.test("extractBearerToken parses valid bearer values", () => {
  assertEquals(extractBearerToken("Bearer token-123"), "token-123");
  assertEquals(extractBearerToken("bearer token-xyz"), "token-xyz");
  assertEquals(extractBearerToken("Basic abc"), "");
  assertEquals(extractBearerToken(null), "");
});

Deno.test("isAuthorizedByAnySecret checks cron and bearer headers", () => {
  const secret = "super-secret-value";

  const cronReq = new Request("https://example.com", {
    method: "POST",
    headers: {
      "x-cron-secret": secret,
    },
  });

  const bearerReq = new Request("https://example.com", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
    },
  });

  const badReq = new Request("https://example.com", {
    method: "POST",
    headers: {
      authorization: "Bearer wrong",
    },
  });

  assert(
    isAuthorizedByAnySecret({
      req: cronReq,
      acceptedSecrets: [secret],
    }),
  );

  assert(
    isAuthorizedByAnySecret({
      req: bearerReq,
      acceptedSecrets: [secret],
    }),
  );

  assertFalse(
    isAuthorizedByAnySecret({
      req: badReq,
      acceptedSecrets: [secret],
    }),
  );
});
