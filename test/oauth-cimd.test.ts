/** Controlled CIMD/JWKS fixtures exercise the real provider's private_key_jwt path.
 * Keys are ephemeral; no external requests, credentials, or client certification.
 */
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/index";
import { hashLoginToken, VOCS_ISSUER } from "../src/login/worker";
import type { Env } from "../src/types";
import loginSchema from "../migrations/login/0001_product_sessions.sql?raw";
import capabilitySchema from "../migrations/login/0002_capability_clients.sql?raw";
import oauthSchema from "../migrations/login/0003_oauth_grants.sql?raw";
const origin = "https://mcp.vocs.io",
  resource = origin + "/openrouter";
const clientId = "https://sdk-cimd.example/client.json";
const otherClientId = "https://sdk-cimd.example/other.json";
const jwksUri = "https://sdk-cimd.example/jwks.json";
const redirectUri = "http://localhost:49153/callback";
const bindings = env as unknown as Env;
const db = bindings.LOGIN_DB!,
  kv = bindings.OAUTH_KV!;
const config: Env = {
  ...bindings,
  PUBLIC_ORIGIN: origin,
  APP_MODE: "production",
  LIVE_PROVIDER: "disabled",
  PRODUCT_LOGIN_ENABLED: "true",
  CAPABILITY_AUTH_ENABLED: "true",
  OAUTH_ENABLED: "true",
  OAUTH_DCR_ENABLED: "true",
};
const browserToken = "c".repeat(43),
  cookie = "__Host-mcp.session=" + browserToken;
async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(origin + path, init),
    config,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
async function form(values: Record<string, string>) {
  return call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}
beforeAll(async () => {
  for (const schema of [loginSchema, capabilitySchema, oauthSchema])
    for (const sql of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
});
afterEach(() => vi.restoreAllMocks());
describe("CIMD private_key_jwt interoperability", () => {
  it("exchanges a PKCE code and authenticates revocation even when the token KV entry is missing", async () => {
    const keys = await generateKeyPair("ES256");
    const wrongKeys = await generateKeyPair("ES256");
    const publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: "fixture-key",
      alg: "ES256",
      use: "sig",
    };
    const requested: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requested.push(url);
      if (url === jwksUri)
        return Response.json(
          { keys: [publicJwk] },
          { headers: { "Cache-Control": "no-store" } },
        );
      if (url === clientId || url === otherClientId)
        return Response.json(
          {
            client_id: url,
            client_name: "Ephemeral CIMD fixture",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code"],
            response_types: ["code"],
            token_endpoint_auth_method: "private_key_jwt",
            token_endpoint_auth_signing_alg: "ES256",
            jwks_uri: jwksUri,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      throw new Error("Unexpected external fetch: " + url);
    });
    await db
      .prepare("INSERT INTO hub_login_principal VALUES (?,?,NULL)")
      .bind(VOCS_ISSUER, "cimd-alice")
      .run();
    await db
      .prepare("INSERT INTO hub_login_session VALUES (?,?,?,?,?,?)")
      .bind(
        await hashLoginToken(browserToken),
        "cimd-browser",
        VOCS_ISSUER,
        "cimd-alice",
        Date.now(),
        Date.now() + 1800000,
      )
      .run();
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(VOCS_ISSUER, "cimd-alice", "models:read")
      .run();
    const verifier = "p".repeat(43);
    const challenge = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      ),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "models:read",
      state: "cimd-state",
      resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const consent = await call("/oauth/authorize?" + query, {
      headers: { cookie },
    });
    expect(consent.status).toBe(200);
    const handle = (await consent.text()).match(
      /name="handle" value="([^"]+)"/,
    )![1];
    const approved = await call("/oauth/authorize", {
      method: "POST",
      headers: {
        cookie:
          cookie + "; " + consent.headers.get("Set-Cookie")!.split(";")[0],
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        handle,
        decision: "approve",
        scope: "models:read",
      }),
    });
    expect(approved.status).toBe(302);
    const callback = new URL(approved.headers.get("Location")!);
    expect(callback.searchParams.get("state")).toBe("cimd-state");
    expect(callback.searchParams.get("iss")).toBe(origin);
    async function assertion(id = clientId, signingKey = keys.privateKey) {
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: "fixture-key" })
        .setIssuer(id)
        .setSubject(id)
        .setAudience(origin + "/oauth/token")
        .setIssuedAt()
        .setExpirationTime("2m")
        .setJti(crypto.randomUUID())
        .sign(signingKey);
    }
    const assertionType =
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    const exchanged = await form({
      client_id: clientId,
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
      client_assertion_type: assertionType,
      client_assertion: await assertion(),
    });
    expect(exchanged.status).toBe(200);
    const token = (await exchanged.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    expect(token.access_token).toBeTruthy();
    expect(token.refresh_token).toBeUndefined();
    expect(requested).toContain(clientId);
    expect(requested).toContain(jwksUri);
    const mapping = await db
      .prepare("SELECT grant_id FROM hub_oauth_token WHERE token_hash=?")
      .bind(await hashLoginToken(token.access_token))
      .first<{ grant_id: string }>();
    expect(mapping).toBeTruthy();
    const active = async () =>
      (await db
        .prepare("SELECT revoked_at FROM hub_oauth_grant WHERE id=?")
        .bind(mapping!.grant_id)
        .first<{ revoked_at: number | null }>())!.revoked_at;
    // Simulate a missing/stale KV token while keeping the primary-consistent map.
    const listed = await kv.list({ prefix: "token:" });
    expect(listed.keys.length).toBeGreaterThan(0);
    const saved = await Promise.all(
      listed.keys.map(async (key) => ({
        name: key.name,
        value: (await kv.get(key.name))!,
      })),
    );
    for (const key of saved) await kv.delete(key.name);
    expect((await kv.list({ prefix: "token:" })).keys).toHaveLength(0);
    const invalid = await form({
      token: token.access_token,
      client_assertion_type: assertionType,
      client_assertion: await assertion(clientId, wrongKeys.privateKey),
    });
    expect(invalid.status).toBe(401);
    expect(await active()).toBeNull();
    const other = await form({
      token: token.access_token,
      client_id: otherClientId,
      client_assertion_type: assertionType,
      client_assertion: await assertion(otherClientId),
    });
    expect(other.status).toBe(200); // RFC7009 deliberately does not expose ownership.
    expect(await active()).toBeNull();
    const revoked = await form({
      token: token.access_token,
      client_assertion_type: assertionType,
      client_assertion: await assertion(),
    });
    expect(revoked.status).toBe(200);
    expect(await active()).toBeTypeOf("number");
    // Restoring stale KV data cannot undo the D1 tombstone.
    for (const key of saved) await kv.put(key.name, key.value);
    expect(
      (
        await call("/openrouter", {
          headers: { Authorization: "Bearer " + token.access_token },
        })
      ).status,
    ).toBe(401);
  });
});
