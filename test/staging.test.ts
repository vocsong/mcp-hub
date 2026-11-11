/** Local Workers bindings only. No deployed staging or third-party client claim. */
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import worker, { type StagingEnv } from "../src/staging";
import production from "../src/index";
import {
  handleLogin,
  hashLoginToken,
  type LoginEnv,
} from "../src/login/worker";
import {
  selectLoginProfile,
  PRODUCTION_LOGIN,
  STAGING_LOGIN,
  type LoginProfile,
} from "../src/login/profile";
import {
  readProductIdentity,
  readClientIdentity,
  handleClientManagement,
} from "../src/authorization";
import { handleOAuth, type OAuthEnv } from "../src/oauth";
import type { Env } from "../src/types";
import loginSchema from "../migrations/login/0001_product_sessions.sql?raw";
import clientSchema from "../migrations/login/0002_capability_clients.sql?raw";
import oauthSchema from "../migrations/login/0003_oauth_grants.sql?raw";
const bindings = env as unknown as Env;
const db = bindings.LOGIN_DB!;
const cfg: StagingEnv = {
  LOGIN_DB: db,
  OAUTH_KV: bindings.OAUTH_KV!,
  PUBLIC_ORIGIN: STAGING_LOGIN.origin,
  LOGIN_PROFILE: "staging",
  APP_MODE: "production",
  STAGING_ENABLED: "true",
  LIVE_PROVIDER: "disabled",
  PRODUCT_LOGIN_ENABLED: "true",
  CAPABILITY_AUTH_ENABLED: "true",
  OAUTH_ENABLED: "true",
  OAUTH_DCR_ENABLED: "true",
};
const settings = (profile: LoginProfile): StagingEnv => ({
  ...cfg,
  LOGIN_PROFILE: profile.name,
  PUBLIC_ORIGIN: profile.origin,
});
const tokenFor = (profile: LoginProfile) =>
  (profile.name === "production" ? "p" : "s").repeat(43);
const cookieFor = (profile: LoginProfile) =>
  "__Host-mcp.session=" + tokenFor(profile);
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .filter((s) => !s.includes("Max-Age=0"))
    .map((s) => s.split(";")[0])
    .join("; ");
async function call(path: string, init: RequestInit = {}, config = cfg) {
  const ctx = createExecutionContext();
  const r = await worker.fetch(
    new Request(config.PUBLIC_ORIGIN! + path, init),
    config,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return r;
}
const post = (body: unknown, origin = STAGING_LOGIN.origin): RequestInit => ({
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
async function seed(profile: LoginProfile) {
  const subject = profile.name + "-alice";
  await db
    .prepare("INSERT INTO hub_login_principal VALUES (?,?,NULL)")
    .bind(profile.issuer, subject)
    .run();
  await db
    .prepare("INSERT INTO hub_login_session VALUES (?,?,?,?,?,?)")
    .bind(
      await hashLoginToken(tokenFor(profile)),
      "browser-" + profile.name,
      profile.issuer,
      subject,
      Date.now(),
      Date.now() + 1800000,
    )
    .run();
  for (const scope of [
    "models:read",
    "speech:write",
    "audio:read",
    "dashboard:manage",
  ])
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(profile.issuer, subject, scope)
      .run();
}
async function loginStart(profile = STAGING_LOGIN as LoginProfile) {
  const r = (await handleLogin(
    new Request(profile.origin + "/login/start", post({}, profile.origin)),
    settings(profile),
  ))!;
  expect(r.status).toBe(200);
  return {
    url: new URL(((await r.json()) as { url: string }).url),
    cookie: cookies(r),
  };
}
async function loginCallback(
  profile: LoginProfile,
  flow: Awaited<ReturnType<typeof loginStart>>,
  issuer = profile.issuer,
) {
  return (await handleLogin(
    new Request(
      profile.origin +
        "/login/callback?" +
        new URLSearchParams({
          code: "c".repeat(43),
          state: flow.url.searchParams.get("state")!,
          iss: issuer,
        }),
      { headers: { cookie: flow.cookie } },
    ),
    settings(profile),
  ))!;
}
async function register() {
  const r = await call(
    "/oauth/register",
    post({
      client_name: "Local staging test",
      redirect_uris: ["http://localhost:3000/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  );
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}
const verifier = "v".repeat(43);
async function begin(
  client: string,
  scope = "models:read",
  cookie = cookieFor(STAGING_LOGIN),
) {
  const r = await call(
    "/oauth/authorize?" +
      new URLSearchParams({
        client_id: client,
        redirect_uri: "http://localhost:3000/callback",
        response_type: "code",
        scope,
        state: "test-state",
        resource: STAGING_LOGIN.origin + "/openrouter",
        code_challenge: await hashLoginToken(verifier),
        code_challenge_method: "S256",
      }),
    { headers: { cookie } },
  );
  const text = await r.text();
  return {
    r,
    handle: text.match(/name="handle" value="([^"]+)"/)?.[1] || "",
    cookie: cookie + "; " + cookies(r),
  };
}
async function issue() {
  const client = await register(),
    consent = await begin(client);
  expect(consent.r.status).toBe(200);
  const r = await call("/oauth/authorize", {
    method: "POST",
    headers: {
      Origin: STAGING_LOGIN.origin,
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: consent.cookie,
    },
    body: new URLSearchParams({
      handle: consent.handle,
      decision: "approve",
      scope: "models:read",
    }),
  });
  expect(r.status).toBe(302);
  const code = new URL(r.headers.get("Location")!).searchParams.get("code")!;
  const exchanged = await call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "http://localhost:3000/callback",
      resource: STAGING_LOGIN.origin + "/openrouter",
    }),
  });
  expect(exchanged.status).toBe(200);
  return ((await exchanged.json()) as { access_token: string }).access_token;
}
const rpc = (token: string, method = "tools/list", params?: object) =>
  call("/openrouter", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params ? { params } : {}),
    }),
  });
beforeAll(async () => {
  for (const schema of [loginSchema, clientSchema, oauthSchema])
    for (const sql of schema.split(";").filter((s) => s.trim()))
      await db.prepare(sql).run();
});
beforeEach(async () => {
  for (const table of [
    "hub_oauth_token",
    "hub_oauth_consent",
    "hub_oauth_grant",
    "hub_oauth_rate",
    "hub_client_token",
    "hub_login_permission",
    "hub_login_session",
    "hub_login_transaction",
    "hub_login_principal",
    "hub_login_rate",
  ])
    await db.prepare("DELETE FROM " + table).run();
  await seed(PRODUCTION_LOGIN);
  await seed(STAGING_LOGIN);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("unexpected network");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("finite identity profiles", () => {
  it("keeps production as the default and rejects every mismatched/unknown profile", async () => {
    expect(selectLoginProfile({ PUBLIC_ORIGIN: PRODUCTION_LOGIN.origin })).toBe(
      PRODUCTION_LOGIN,
    );
    for (const bad of [
      { PUBLIC_ORIGIN: STAGING_LOGIN.origin },
      { LOGIN_PROFILE: "staging", PUBLIC_ORIGIN: PRODUCTION_LOGIN.origin },
      { LOGIN_PROFILE: "production", PUBLIC_ORIGIN: STAGING_LOGIN.origin },
      { LOGIN_PROFILE: "custom", PUBLIC_ORIGIN: "https://evil.test" },
      { LOGIN_PROFILE: "staging", PUBLIC_ORIGIN: STAGING_LOGIN.origin + "/" },
    ]) {
      expect(selectLoginProfile(bad)).toBeNull();
      const r = (await handleLogin(
        new Request(STAGING_LOGIN.origin + "/login"),
        { ...cfg, ...bad, LOGIN_PROFILE: bad.LOGIN_PROFILE },
      ))!;
      expect(r.status).toBe(503);
    }
  });
  it.each([PRODUCTION_LOGIN, STAGING_LOGIN])(
    "pins $name authorize, issuer, client and callback without browser overrides",
    async (profile) => {
      const flow = await loginStart(profile);
      expect(flow.url.origin).toBe(profile.issuer);
      expect(flow.url.pathname).toBe("/authorize");
      expect(flow.url.searchParams.get("client_id")).toBe(profile.clientId);
      expect(flow.url.searchParams.get("redirect_uri")).toBe(
        profile.origin + "/login/callback",
      );
      expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
      const override = await handleLogin(
        new Request(
          profile.origin + "/login/start?issuer=https://evil.test",
          post({}, profile.origin),
        ),
        settings(profile),
      );
      expect(override!.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([PRODUCTION_LOGIN, STAGING_LOGIN])(
    "rejects opposite-realm callback issuers before network in $name",
    async (profile) => {
      const other =
        profile === PRODUCTION_LOGIN ? STAGING_LOGIN : PRODUCTION_LOGIN;
      const r = await loginCallback(
        profile,
        await loginStart(profile),
        other.issuer,
      );
      expect(r.headers.get("Location")).toBe("/login/error");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([PRODUCTION_LOGIN, STAGING_LOGIN])(
    "rejects opposite-realm exchange issuer and audience in $name",
    async (profile) => {
      const other =
        profile === PRODUCTION_LOGIN ? STAGING_LOGIN : PRODUCTION_LOGIN;
      for (const override of [
        { issuer: other.issuer },
        { audience: other.clientId },
      ]) {
        const flow = await loginStart(profile);
        vi.mocked(fetch).mockResolvedValueOnce(
          Response.json({
            issuer: profile.issuer,
            audience: profile.clientId,
            subject: "fresh-account",
            authenticated_at: new Date().toISOString(),
            ...override,
          }),
        );
        expect(
          (await loginCallback(profile, flow)).headers.get("Location"),
        ).toBe("/login/error");
      }
    },
  );
  it("exchanges staging identity only with its exact issuer/client/callback", async () => {
    const flow = await loginStart();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        issuer: STAGING_LOGIN.issuer,
        audience: STAGING_LOGIN.clientId,
        subject: "new-staging-account",
        authenticated_at: new Date().toISOString(),
      }),
    );
    const r = await loginCallback(STAGING_LOGIN, flow);
    expect(r.headers.get("Location")).toBe("/account");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(STAGING_LOGIN.issuer + "/sso/token");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      client_id: STAGING_LOGIN.clientId,
      redirect_uri: STAGING_LOGIN.origin + "/login/callback",
    });
    const checked = await call("/login/session", {
      headers: { cookie: cookies(r) },
    });
    expect(await checked.json()).toMatchObject({
      issuer: STAGING_LOGIN.issuer,
      subject: "new-staging-account",
      permissions: [],
    });
  });
  it.each([PRODUCTION_LOGIN, STAGING_LOGIN])(
    "rejects opposite-realm browser/manual identities and does not log them out in $name",
    async (profile) => {
      const other =
        profile === PRODUCTION_LOGIN ? STAGING_LOGIN : PRODUCTION_LOGIN;
      const request = new Request(profile.origin + "/dashboard", {
        headers: { cookie: cookieFor(other) },
      });
      await expect(
        readProductIdentity(request, settings(profile)),
      ).rejects.toMatchObject({ code: "authentication_required" });
      const session = (await handleLogin(
        new Request(profile.origin + "/login/session", {
          headers: { cookie: cookieFor(other) },
        }),
        settings(profile),
      ))!;
      expect(session.status).toBe(401);
      const manual = "vmcp_" + "m".repeat(43);
      await db
        .prepare(
          "INSERT INTO hub_client_token VALUES (?,?,?,?,?,?,?,?,?,?,NULL)",
        )
        .bind(
          crypto.randomUUID(),
          await hashLoginToken(manual),
          await hashLoginToken(tokenFor(other)),
          other.issuer,
          other.name + "-alice",
          "dots",
          '["models:read"]',
          profile.origin + "/openrouter",
          Date.now(),
          Date.now() + 60000,
        )
        .run();
      await expect(
        readClientIdentity(
          new Request(profile.origin + "/openrouter", {
            headers: { Authorization: "Bearer " + manual },
          }),
          settings(profile),
        ),
      ).rejects.toMatchObject({ code: "invalid_identity" });
      await handleLogin(
        new Request(profile.origin + "/login/logout", {
          ...post({}, profile.origin),
          headers: {
            Origin: profile.origin,
            "Content-Type": "application/json",
            cookie: cookieFor(other),
          },
        }),
        settings(profile),
      );
      expect(
        await db
          .prepare(
            "SELECT token_hash FROM hub_login_session WHERE token_hash=?",
          )
          .bind(await hashLoginToken(tokenFor(other)))
          .first(),
      ).not.toBeNull();
    },
  );
});
describe("models-only staging entry", () => {
  it("sets staging-only HSTS on local and delegated responses", async () => {
    for (const path of [
      "/",
      "/health",
      "/login",
      "/account",
      "/openrouter",
      "/.well-known/oauth-authorization-server",
    ]) {
      const response = await call(path);
      expect(response.headers.get("Strict-Transport-Security")).toBe(
        "max-age=86400",
      );
    }
  });
  it("fails closed when disabled, misbound or configured for paid/provider access", async () => {
    for (const patch of [
      { STAGING_ENABLED: "false" },
      { LIVE_PROVIDER: "enabled" },
      { LOGIN_PROFILE: "production" },
      { APP_MODE: "local" },
      { PRODUCT_LOGIN_ENABLED: "false" },
      { CAPABILITY_AUTH_ENABLED: "false" },
      { OAUTH_ENABLED: "false" },
      { LOGIN_DB: undefined },
      { OAUTH_KV: undefined },
      { KEY_ENCRYPTION_KEY: "forbidden" },
      { OPENROUTER_API_KEY: "forbidden" },
      { AUDIO: {} },
      { TENANTS: {} },
    ]) {
      const r = await call("/login", {}, { ...cfg, ...patch });
      expect(r.status).toBe(503);
    }
    const ctx = createExecutionContext();
    const wrongHost = await worker.fetch(
      new Request(PRODUCTION_LOGIN.origin + "/login"),
      cfg,
      ctx,
    );
    expect(wrongHost.status).toBe(403);
    const wrongEntry = await production.fetch(
      new Request(STAGING_LOGIN.origin + "/login"),
      { ...bindings, ...cfg } as Env,
      ctx,
    );
    expect(wrongEntry.status).toBe(503);
    expect(await wrongEntry.json()).toEqual({
      error: "staging_entry_required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies dashboard, manual credentials, keys, speech, audio and unknown routes without touching execution bindings", async () => {
    for (const path of [
      "/dashboard",
      "/api/status",
      "/api/clients",
      "/api/clients/" + crypto.randomUUID(),
      "/api/key",
      "/api/policy",
      "/api/speech",
      "/api/approve",
      "/audio/" + crypto.randomUUID(),
      "/api/audio/" + crypto.randomUUID(),
      "/openrouter/audio/" + crypto.randomUUID(),
      "/proxy",
    ]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const r = await call(path, {
          method,
          headers: { cookie: cookieFor(STAGING_LOGIN) },
        });
        expect(r.status).toBe(403);
        expect(await r.json()).toEqual({ error: "staging_read_only" });
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("advertises models-only discovery and requires OAuth rather than a browser session", async () => {
    const discovery = await call("/.well-known/oauth-authorization-server");
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      issuer: STAGING_LOGIN.origin,
      scopes_supported: ["models:read"],
    });
    expect((await call("/openrouter")).status).toBe(401);
    expect(
      (
        await call("/openrouter", {
          headers: { cookie: cookieFor(STAGING_LOGIN) },
        })
      ).status,
    ).toBe(401);
  });
  it("rejects paid scopes even when storage contains those grants", async () => {
    const client = await register();
    for (const scope of [
      "models:read speech:write",
      "models:read audio:read",
    ]) {
      const attempt = await begin(client, scope);
      expect(attempt.r.status).not.toBe(200);
      expect(attempt.handle).toBe("");
    }
    const manual = await handleClientManagement(
      new Request(STAGING_LOGIN.origin + "/api/clients", {
        ...post({ clientId: "dots", consent: true, scopes: ["speech:write"] }),
        headers: {
          Origin: STAGING_LOGIN.origin,
          "Content-Type": "application/json",
          "X-Vocs-Intent": "dashboard",
          cookie: cookieFor(STAGING_LOGIN),
        },
      }),
      cfg,
    );
    expect(manual!.status).toBe(400);
  });
  it("does not accept a production session for staging OAuth consent", async () => {
    const consent = await begin(
      await register(),
      "models:read",
      cookieFor(PRODUCTION_LOGIN),
    );
    expect(consent.r.status).toBe(401);
    expect(consent.handle).toBe("");
  });
  it("runs local consent, code exchange and MCP catalog without speech or provider calls", async () => {
    const token = await issue();
    const tools = await rpc(token);
    expect(tools.status).toBe(200);
    const result = (await tools.json()) as {
      result: { tools: { name: string }[] };
    };
    expect(result.result.tools.map((t) => t.name)).toEqual([
      "openrouter_models",
    ]);
    const model = await rpc(token, "tools/call", {
      name: "openrouter_models",
      arguments: {},
    });
    expect(await model.json()).toMatchObject({
      result: {
        content: [
          {
            type: "text",
            text: expect.stringContaining('"executionEnabled":false'),
          },
        ],
      },
    });
    expect(
      (
        await rpc(token, "tools/call", {
          name: "openrouter_speech",
          arguments: { text: "Must never execute" },
        })
      ).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects staging tokens at the production resource and rechecks issuer on every use", async () => {
    const token = await issue();
    const ctx = createExecutionContext();
    const other = await handleOAuth(
      new Request(PRODUCTION_LOGIN.origin + "/openrouter", {
        headers: { Authorization: "Bearer " + token },
      }),
      settings(PRODUCTION_LOGIN) as OAuthEnv,
      ctx,
      async () => Response.json({ bad: "accepted" }),
    );
    expect(other!.status).toBe(401);
    await waitOnExecutionContext(ctx);
    await db
      .prepare("UPDATE hub_oauth_grant SET issuer=?,subject=?,session_hash=?")
      .bind(
        PRODUCTION_LOGIN.issuer,
        "production-alice",
        await hashLoginToken(tokenFor(PRODUCTION_LOGIN)),
      )
      .run();
    expect((await rpc(token)).status).toBe(401);
  });
  it.each(["remove grant", "disable principal", "logout"])(
    "rejects existing staging OAuth tokens after %s",
    async (change) => {
      const token = await issue();
      expect((await rpc(token)).status).toBe(200);
      if (change === "remove grant")
        await db
          .prepare(
            "DELETE FROM hub_login_permission WHERE issuer=? AND permission='models:read'",
          )
          .bind(STAGING_LOGIN.issuer)
          .run();
      if (change === "disable principal")
        await db
          .prepare(
            "UPDATE hub_login_principal SET disabled_at=? WHERE issuer=?",
          )
          .bind(Date.now(), STAGING_LOGIN.issuer)
          .run();
      if (change === "logout")
        await call("/login/logout", {
          ...post({}),
          headers: {
            Origin: STAGING_LOGIN.origin,
            "Content-Type": "application/json",
            cookie: cookieFor(STAGING_LOGIN),
          },
        });
      expect((await rpc(token)).status).toBe(401);
    },
  );
});
