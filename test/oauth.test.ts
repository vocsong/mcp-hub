import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, it, expect } from "vitest";
import { handleOAuth, type OAuthEnv } from "../src/oauth";
import { hashLoginToken, VOCS_ISSUER } from "../src/login/worker";
import schema from "../migrations/login/0001_product_sessions.sql?raw";
import oauthSchema from "../migrations/login/0003_oauth_grants.sql?raw";
const db = (env as unknown as { LOGIN_DB: D1Database }).LOGIN_DB;
const origin = "https://mcp.vocs.io",
  resource = origin + "/openrouter";
const cfg: OAuthEnv = {
  LOGIN_DB: db,
  OAUTH_KV: (env as unknown as { OAUTH_KV: KVNamespace }).OAUTH_KV,
  PUBLIC_ORIGIN: origin,
  APP_MODE: "production",
  PRODUCT_LOGIN_ENABLED: "true",
  CAPABILITY_AUTH_ENABLED: "true",
  OAUTH_ENABLED: "true",
  OAUTH_DCR_ENABLED: "true",
};
const sessionToken = "a".repeat(43),
  cookie = "__Host-mcp.session=" + sessionToken;
const verifier = "a".repeat(43);
async function call(path: string, init: RequestInit = {}, settings = cfg) {
  const ctx = createExecutionContext();
  const r = await handleOAuth(
    new Request(origin + path, init),
    settings,
    ctx,
    async (who) => Response.json(who),
  );
  await waitOnExecutionContext(ctx);
  return r!;
}
async function register() {
  const r = await call("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test <script>",
      redirect_uris: ["http://localhost:3000/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}
async function begin(
  client: string,
  scope = "models:read",
  extra: Record<string, string> = {},
) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const challenge = btoa(String.fromCharCode(...hash))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const q = new URLSearchParams({
    client_id: client,
    redirect_uri: "http://localhost:3000/callback",
    response_type: "code",
    scope,
    state: "state-value",
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  });
  const r = await call("/oauth/authorize?" + q, { headers: { cookie } });
  const html = await r.text();
  return {
    r,
    html,
    handle: html.match(/name="handle" value="([^"]+)"/)?.[1] || "",
    cookies: cookie + "; " + (r.headers.get("Set-Cookie") || "").split(";")[0],
  };
}
async function approve(
  b: Awaited<ReturnType<typeof begin>>,
  scopes = ["models:read"],
  extra: Record<string, string> = {},
  decision = "approve",
) {
  const form = new URLSearchParams({ handle: b.handle, decision });
  scopes.forEach((s) => form.append("scope", s));
  return call("/oauth/authorize", {
    method: "POST",
    headers: {
      cookie: b.cookies,
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
      ...extra,
    },
    body: form,
  });
}
async function exchange(
  client: string,
  code: string,
  extra: Record<string, string> = {},
) {
  return call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "http://localhost:3000/callback",
      resource,
      ...extra,
    }),
  });
}
async function issue(scope = "models:read") {
  const client = await register(),
    b = await begin(client, scope),
    r = await approve(b, scope.split(" "));
  expect(r.status).toBe(302);
  const redirect = new URL(r.headers.get("Location")!);
  expect(redirect.searchParams.get("state")).toBe("state-value");
  expect(redirect.searchParams.get("iss")).toBe(origin);
  const code = redirect.searchParams.get("code")!;
  const tokenResponse = await exchange(client, code);
  expect(tokenResponse.status).toBe(200);
  const token = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return { client, code, token };
}
const access = (token: string, path = "/openrouter", body?: unknown) =>
  call(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  for (const sql of [schema, oauthSchema])
    for (const stmt of sql
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await db.prepare(stmt).run();
});
beforeEach(async () => {
  for (const table of [
    "hub_oauth_consent",
    "hub_oauth_grant",
    "hub_oauth_rate",
    "hub_login_permission",
    "hub_login_session",
    "hub_login_principal",
  ])
    await db.prepare("DELETE FROM " + table).run();
  await db
    .prepare("INSERT INTO hub_login_principal VALUES (?,?,NULL)")
    .bind(VOCS_ISSUER, "alice")
    .run();
  await db
    .prepare("INSERT INTO hub_login_session VALUES (?,?,?,?,?,?)")
    .bind(
      await hashLoginToken(sessionToken),
      "browser",
      VOCS_ISSUER,
      "alice",
      Date.now(),
      Date.now() + 1800000,
    )
    .run();
  for (const s of ["models:read", "speech:write", "audio:read"])
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(VOCS_ISSUER, "alice", s)
      .run();
});
describe("official-library OAuth with primary D1 guards", () => {
  it("is off by default and publishes standards discovery/challenge when enabled", async () => {
    expect(
      await call("/openrouter", {}, { ...cfg, OAUTH_ENABLED: "false" }),
    ).toBeNull();
    const d = await call("/.well-known/oauth-authorization-server");
    expect(d.status).toBe(200);
    expect(await d.json()).toMatchObject({
      issuer: origin,
      token_endpoint: origin + "/oauth/token",
      code_challenge_methods_supported: ["S256"],
    });
    const m = await call("/.well-known/oauth-protected-resource/openrouter");
    expect(await m.json()).toMatchObject({
      resource,
      scopes_supported: ["models:read"],
    });
    const c = await call("/openrouter");
    expect(c.status).toBe(401);
    expect(c.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });
  it("requires explicit consent, escapes client names, issues no refresh token and no dashboard", async () => {
    const { token } = await issue();
    expect(token.refresh_token).toBeUndefined();
    expect(token.expires_in).toBeLessThanOrEqual(300);
    const r = await access(token.access_token);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      dashboard: false,
      scopes: ["models:read"],
    });
    const no = await access(token.access_token, "/openrouter", {
      method: "tools/call",
      params: { name: "openrouter_speech" },
    });
    expect(no.status).toBe(403);
    expect(no.headers.get("WWW-Authenticate")).toContain("speech:write");
    expect(
      (await access(token.access_token, "/openrouter/audio/x")).status,
    ).toBe(403);
  });
  it("rejects plain PKCE, wrong redirect/resource, unsupported scope and confidential DCR", async () => {
    const client = await register();
    for (const extra of [
      { code_challenge_method: "plain" },
      { redirect_uri: "https://evil.test/" },
      { resource: "https://other.test/openrouter" },
    ])
      expect((await begin(client, "models:read", extra)).r.status).not.toBe(
        200,
      );
    expect(
      (await begin(client, "models:read dashboard:manage")).r.status,
    ).not.toBe(200);
    const r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost/cb"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    expect(r.status).toBe(400);
  });
  it("checks verifier, redirect, resource and consumes codes once", async () => {
    const client = await register(),
      b = await begin(client),
      r = await approve(b);
    const code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
    for (const extra of [
      { code_verifier: "b".repeat(43) },
      { redirect_uri: "http://localhost:3001/callback" },
      { resource: "https://other.test/openrouter" },
    ])
      expect((await exchange(client, code, extra)).status).not.toBe(200);
    expect((await exchange(client, code)).status).toBe(200);
    expect((await exchange(client, code)).status).not.toBe(200);
  });
  it("consent is single-use, same-origin, exact-session-bound and cannot escalate", async () => {
    const client = await register();
    let b = await begin(client);
    expect(b.html).toContain("&lt;script&gt;");
    expect(
      (await approve(b, ["models:read"], { Origin: "https://evil.test" }))
        .status,
    ).toBe(403);
    expect((await approve(b, ["models:read", "speech:write"])).status).toBe(
      400,
    );
    b = await begin(client);
    const responses = await Promise.all([approve(b), approve(b)]);
    expect(responses.map((r) => r.status).sort()).toEqual([302, 400]);
    b = await begin(client);
    await db
      .prepare("INSERT INTO hub_login_session VALUES (?,?,?,?,?,?)")
      .bind(
        await hashLoginToken("b".repeat(43)),
        "other-browser",
        VOCS_ISSUER,
        "alice",
        Date.now(),
        Date.now() + 1800000,
      )
      .run();
    expect(
      (
        await approve(b, ["models:read"], {
          cookie: b.cookies.replace(sessionToken, "b".repeat(43)),
        })
      ).status,
    ).toBe(400);
  });
  it("denial preserves state and issuer without a grant", async () => {
    const client = await register(),
      b = await begin(client);
    const r = await approve(b, [], {}, "deny");
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get("Location")!);
    expect(u.searchParams.get("error")).toBe("access_denied");
    expect(u.searchParams.get("state")).toBe("state-value");
    expect(u.searchParams.get("iss")).toBe(origin);
    expect((await approve(b)).status).toBe(400);
  });
  it("immediately blocks source grant removal, suspension, logout and browser revoke", async () => {
    let { token } = await issue();
    await db
      .prepare(
        "DELETE FROM hub_login_permission WHERE permission='models:read'",
      )
      .run();
    expect((await access(token.access_token)).status).toBe(401);
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(VOCS_ISSUER, "alice", "models:read")
      .run();
    await db.prepare("UPDATE hub_login_principal SET disabled_at=1").run();
    expect((await access(token.access_token)).status).toBe(401);
    await db.prepare("UPDATE hub_login_principal SET disabled_at=NULL").run();
    const list = await call("/api/oauth/grants", { headers: { cookie } });
    const id = ((await list.json()) as { grants: { id: string }[] }).grants[0]
      .id;
    expect(
      (
        await call("/api/oauth/grants/" + id, {
          method: "DELETE",
          headers: { cookie, Origin: origin },
        })
      ).status,
    ).toBe(200);
    expect((await access(token.access_token)).status).toBe(401);
    ({ token } = await issue());
    await db.prepare("DELETE FROM hub_login_session").run();
    expect((await access(token.access_token)).status).toBe(401);
  });
  it("standard token revocation uses a D1 tombstone and wrong client cannot revoke", async () => {
    const { token, client } = await issue(),
      other = await register();
    for (const id of [other, client]) {
      const r = await call("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: id, token: token.access_token }),
      });
      expect(r.status).toBe(200);
      expect((await access(token.access_token)).status).toBe(
        id === client ? 401 : 200,
      );
    }
  });
  it("expired freshness and concurrent exchange fail closed", async () => {
    const client = await register(),
      b = await begin(client),
      r = await approve(b);
    const code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
    const responses = await Promise.all([
      exchange(client, code),
      exchange(client, code),
    ]);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    await db
      .prepare("UPDATE hub_login_session SET authenticated_at=?")
      .bind(Date.now() - 250000)
      .run();
    expect((await begin(client)).r.status).toBe(401);
  });
  it("rechecks source grants and freshness at token exchange", async () => {
    const client = await register();
    let b = await begin(client),
      r = await approve(b),
      code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
    await db
      .prepare(
        "DELETE FROM hub_login_permission WHERE permission='models:read'",
      )
      .run();
    expect((await exchange(client, code)).status).toBe(400);
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(VOCS_ISSUER, "alice", "models:read")
      .run();
    b = await begin(client);
    r = await approve(b);
    code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
    await db
      .prepare("UPDATE hub_login_session SET authenticated_at=?")
      .bind(Date.now() - 250000)
      .run();
    expect((await exchange(client, code)).status).toBe(400);
  });
  it("permits a selected subset, never scopes not requested, and rejects refresh", async () => {
    const client = await register(),
      b = await begin(client, "models:read speech:write audio:read"),
      r = await approve(b, ["models:read"]);
    const code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
    const result = await exchange(client, code),
      t = (await result.json()) as { access_token: string; scope: string };
    expect(t.scope).toBe("models:read");
    expect(
      (
        await call("/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: client,
            grant_type: "refresh_token",
            refresh_token: t.access_token,
          }),
        })
      ).status,
    ).not.toBe(200);
    expect(
      await call("/api/key", {
        headers: { Authorization: "Bearer " + t.access_token },
      }),
    ).toBeNull();
  });
  it("does not approve a pending consent after switching to a different principal", async () => {
    const client = await register(),
      b = await begin(client);
    await db
      .prepare("INSERT INTO hub_login_principal VALUES (?,?,NULL)")
      .bind(VOCS_ISSUER, "bob")
      .run();
    await db
      .prepare("INSERT INTO hub_login_session VALUES (?,?,?,?,?,?)")
      .bind(
        await hashLoginToken("b".repeat(43)),
        "bob-browser",
        VOCS_ISSUER,
        "bob",
        Date.now(),
        Date.now() + 1800000,
      )
      .run();
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(VOCS_ISSUER, "bob", "models:read")
      .run();
    expect(
      (
        await approve(b, ["models:read"], {
          cookie: b.cookies.replace(sessionToken, "b".repeat(43)),
        })
      ).status,
    ).toBe(400);
    expect((await approve(b)).status).toBe(302);
  });
  it("bounds registration bodies and rate, rejects browser management cross-origin", async () => {
    expect(
      (
        await call("/oauth/register", {
          method: "POST",
          body: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    for (let i = 0; i < 10; i++) await register();
    const r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(r.status).toBe(429);
    expect(
      (
        await call("/api/oauth/grants/00000000-0000-0000-0000-000000000000", {
          method: "DELETE",
          headers: { cookie, Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
  });
  it("rejects foreign-origin and mixed credentials on the protected resource", async () => {
    const { token } = await issue();
    for (const headers of [
      { Origin: "https://evil.test" },
      { "Sec-Fetch-Site": "cross-site" },
    ])
      expect(
        (
          await call("/openrouter", {
            headers: {
              Authorization: "Bearer " + token.access_token,
              ...headers,
            },
          })
        ).status,
      ).toBe(403);
    for (const headers of [
      { Cookie: cookie },
      { "Cf-Access-Jwt-Assertion": "ignored" },
    ])
      expect(
        (
          await call("/openrouter", {
            headers: {
              Authorization: "Bearer " + token.access_token,
              ...headers,
            },
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await call("/openrouter", {
          headers: {
            Authorization: "Bearer " + token.access_token,
            Origin: origin,
          },
        })
      ).status,
    ).toBe(200);
  });
  it("requires RFC7636 challenge and verifier lengths and alphabets", async () => {
    const client = await register();
    for (const challenge of [
      "a",
      "a".repeat(42),
      "a".repeat(44),
      "!".repeat(43),
    ])
      expect(
        (await begin(client, "models:read", { code_challenge: challenge })).r
          .status,
      ).not.toBe(200);
    const b = await begin(client),
      r = await approve(b),
      code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
    for (const v of ["a", "a".repeat(42), "a".repeat(129), "!".repeat(43)])
      expect((await exchange(client, code, { code_verifier: v })).status).toBe(
        400,
      );
    expect((await exchange(client, code)).status).toBe(200);
  });
  it("revokes durably when the token KV record is absent, including wrong-client opacity", async () => {
    const { token, client } = await issue(),
      other = await register();
    const parts = token.access_token.split(":"),
      prefix = "token:" + parts[0] + ":" + parts[1] + ":";
    const kv = cfg.OAUTH_KV!;
    const listing = await kv.list({ prefix });
    expect(listing.keys).toHaveLength(1);
    const key = listing.keys[0].name,
      saved = (await kv.get(key))!;
    await kv.delete(key);
    const revoke = (id: string) =>
      call("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: id, token: token.access_token }),
      });
    expect((await revoke(other)).status).toBe(200);
    await kv.put(key, saved, { expirationTtl: 300 });
    expect((await access(token.access_token)).status).toBe(200);
    await kv.delete(key);
    expect((await revoke(client)).status).toBe(200);
    await kv.put(key, saved, { expirationTtl: 300 });
    expect((await access(token.access_token)).status).toBe(401);
    const row = await db
      .prepare("SELECT token_hash FROM hub_oauth_token WHERE token_hash=?")
      .bind(await hashLoginToken(token.access_token))
      .first();
    expect(row).not.toBeNull();
  });
});
