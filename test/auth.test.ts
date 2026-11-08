import { env } from "cloudflare:test";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { privateRateLimit } from "../src/auth/rate-limit";
import worker from "../src/auth/worker";
import { authOptions, type AuthEnv } from "../src/auth/config";
import schema from "../migrations/auth/0001_better_auth.sql?raw";
import admission from "../migrations/auth/0002_admission.sql?raw";
const db = (env as unknown as { AUTH_DB: D1Database }).AUTH_DB;
const origin = "https://auth.example.test";
const cfg: AuthEnv = {
  AUTH_ENABLED: "true",
  AUTH_DB: db,
  AUTH_ORIGIN: origin,
  AUTH_SECRET: "test-only-secret-012345678901234567890123456789",
  GITHUB_CLIENT_ID: "test-client",
  GITHUB_CLIENT_SECRET: "test-provider-secret",
};
const req = (
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(
    origin + path,
    body === undefined
      ? { headers }
      : {
          method: "POST",
          headers: { origin, "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
  );
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
async function invite(email = "one@example.test") {
  await db
    .prepare("INSERT OR REPLACE INTO hub_invitation(email) VALUES (?)")
    .bind(email)
    .run();
}
async function login(
  email = "one@example.test",
  id = 123,
  verified = true,
  cookie = "",
) {
  const started = await worker.fetch(
    req(
      "/api/auth/sign-in/social",
      { provider: "github" },
      cookie ? { cookie } : {},
    ),
    cfg,
  );
  const data = (await started.json()) as { url: string };
  expect(started.status).toBe(200);
  const state = new URL(data.url).searchParams.get("state");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const u =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (u === "https://github.com/login/oauth/access_token")
        return Response.json({
          access_token: "provider-token-never-store",
          token_type: "bearer",
          scope: "read:user,user:email",
        });
      if (u === "https://api.github.com/user")
        return Response.json({ id, login: "test-user", name: "Test", email });
      if (u === "https://api.github.com/user/emails")
        return Response.json([{ email, primary: true, verified }]);
      throw new Error("Unexpected external fetch");
    }),
  );
  return worker.fetch(
    req(`/api/auth/callback/github?code=test-code&state=${state}`, undefined, {
      cookie: cookies(started),
    }),
    cfg,
  );
}
beforeAll(async () => {
  for (const sql of [schema, admission])
    for (const statement of sql.split(";").filter((s) => s.trim()))
      await db.prepare(statement).run();
});
beforeEach(async () => {
  for (const table of [
    "session",
    "account",
    "user",
    "verification",
    "rateLimit",
    "hub_invitation",
    "hub_rate_limit",
  ])
    await db.prepare(`DELETE FROM "${table}"`).run();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("Vocs login boundary", () => {
  it("fails closed by default and on missing config", async () => {
    expect((await worker.fetch(req("/account"), {})).status).toBe(503);
    expect(
      (await worker.fetch(req("/account"), { AUTH_ENABLED: "true" })).status,
    ).toBe(503);
    expect(() =>
      authOptions({ ...cfg, AUTH_ORIGIN: "http://auth.example.test" }),
    ).toThrow();
  });
  it("rejects cross-site login, token injection, linking and browser MCP access", async () => {
    expect(
      (
        await worker.fetch(
          req(
            "/api/auth/sign-in/social",
            { provider: "github" },
            { origin: "https://evil.test" },
          ),
          cfg,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          req("/api/auth/sign-in/social", {
            provider: "github",
            idToken: { token: "bad" },
          }),
          cfg,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          req("/api/auth/sign-in/social", {
            provider: "github",
            callbackURL: "https://evil.test",
          }),
          cfg,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          req("/api/auth/link-social", { provider: "github" }),
          cfg,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await worker.fetch(
          req("/openrouter", undefined, { cookie: "anything" }),
          cfg,
        )
      ).status,
    ).toBe(401);
  });
  it("uses browser-bound state and refuses missing/forged callback state", async () => {
    const start = await worker.fetch(
      req("/api/auth/sign-in/social", { provider: "github" }),
      cfg,
    );
    expect(start.headers.get("set-cookie")).toContain("__Host-vocs.state=");
    expect(start.headers.get("set-cookie")).toContain("Secure");
    expect(start.headers.get("set-cookie")).toContain("HttpOnly");
    const url = new URL(((await start.json()) as { url: string }).url);
    for (const cookie of ["", "__Host-vocs.state=forged"]) {
      const response = await worker.fetch(
        req(
          "/api/auth/callback/github?code=x&state=" +
            url.searchParams.get("state"),
          undefined,
          { cookie },
        ),
        cfg,
      );
      expect(response.headers.get("location")).not.toBe(origin + "/account");
    }
    expect(
      (await db.prepare("SELECT * FROM session").all()).results,
    ).toHaveLength(0);
  });
  it("admits verified invite, strips provider tokens and fixes no supplied session", async () => {
    await invite();
    const result = await login(
      "one@example.test",
      123,
      true,
      "__Host-vocs.session_token=attacker",
    );
    expect(result.headers.get("location")).toBe(origin + "/account");
    const cookie = cookies(result);
    expect(cookie).toContain("__Host-vocs.session_token=");
    expect(cookie).not.toContain("attacker");
    expect(result.headers.get("set-cookie")).not.toContain("Domain=");
    const accounts = (await db.prepare("SELECT * FROM account").all()).results;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accessToken).toBeNull();
    expect(accounts[0].refreshToken).toBeNull();
    expect(accounts[0].idToken).toBeNull();
    const account = await worker.fetch(
      req("/account", undefined, { cookie }),
      cfg,
    );
    expect(account.status).toBe(200);
    expect(
      ((await account.json()) as { mcpAuthorized: boolean }).mcpAuthorized,
    ).toBe(false);
    const sessions = (await db.prepare("SELECT * FROM session").all()).results;
    expect(sessions[0].ipAddress).toBeNull();
    expect(sessions[0].userAgent).toBeNull();
    await db
      .prepare("UPDATE hub_invitation SET revoked_at = ?")
      .bind(Date.now())
      .run();
    expect(
      (await worker.fetch(req("/account", undefined, { cookie }), cfg)).status,
    ).toBe(403);
  });
  it("rejects uninvited and unverified identities", async () => {
    const missing = await login();
    expect(missing.headers.get("location")).not.toBe(origin + "/account");
    await invite();
    const unverified = await login("one@example.test", 123, false);
    expect(unverified.headers.get("location")).not.toBe(origin + "/account");
    expect(
      (await db.prepare("SELECT * FROM session").all()).results,
    ).toHaveLength(0);
  });
  it("does not link a different provider subject with the same email", async () => {
    await invite();
    const first = await login();
    expect(first.headers.get("location")).toBe(origin + "/account");
    const second = await login("one@example.test", 456);
    expect(second.headers.get("location")).not.toBe(origin + "/account");
    expect(
      (await db.prepare("SELECT * FROM account").all()).results,
    ).toHaveLength(1);
  });
  it("revokes sessions and rejects expired sessions immediately", async () => {
    await invite();
    const result = await login();
    const cookie = cookies(result);
    const revoke = await worker.fetch(
      req("/api/auth/revoke-sessions", {}, { cookie }),
      cfg,
    );
    expect(revoke.status).toBe(200);
    expect(
      (await worker.fetch(req("/account", undefined, { cookie }), cfg)).status,
    ).toBe(401);
    const again = await login();
    const next = cookies(again);
    await db
      .prepare("UPDATE session SET expiresAt = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect(
      (await worker.fetch(req("/account", undefined, { cookie: next }), cfg))
        .status,
    ).toBe(401);
  });
  it("rechecks provider verification for returning users and isolates two accounts", async () => {
    await invite();
    await invite("two@example.test");
    const one = await login();
    const two = await login("two@example.test", 456);
    const a = (await (
      await worker.fetch(
        req("/account", undefined, { cookie: cookies(one) }),
        cfg,
      )
    ).json()) as { user: { id: string } };
    const b = (await (
      await worker.fetch(
        req("/account", undefined, { cookie: cookies(two) }),
        cfg,
      )
    ).json()) as { user: { id: string } };
    expect(a.user.id).not.toBe(b.user.id);
    const changed = await login("one@example.test", 123, false);
    expect(changed.headers.get("location")).not.toBe(origin + "/account");
    await worker.fetch(
      req("/api/auth/sign-out", {}, { cookie: cookies(one) }),
      cfg,
    );
    expect(
      (
        await worker.fetch(
          req("/account", undefined, { cookie: cookies(one) }),
          cfg,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(
          req("/account", undefined, { cookie: cookies(two) }),
          cfg,
        )
      ).status,
    ).toBe(200);
  });
  it("consumes OAuth state once and suppresses raw provider errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = await worker.fetch(
      req("/api/auth/sign-in/social", { provider: "github" }),
      cfg,
    );
    const state = new URL(
      ((await started.json()) as { url: string }).url,
    ).searchParams.get("state");
    const provider = vi.fn(async () =>
      Response.json(
        { error: "SECRET_SENTINEL_PROVIDER_BODY" },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", provider);
    const callback = req(
      `/api/auth/callback/github?code=SECRET_SENTINEL_CODE&state=${state}`,
      undefined,
      { cookie: cookies(started) },
    );
    await worker.fetch(callback.clone(), cfg);
    const count = provider.mock.calls.length;
    await worker.fetch(callback.clone(), cfg);
    expect(provider.mock.calls.length).toBe(count);
    expect(
      JSON.stringify([...error.mock.calls, ...warn.mock.calls]),
    ).not.toContain("SECRET_SENTINEL");
    error.mockRestore();
    warn.mockRestore();
  });
  it("bounds body size and rejects ambiguous redirect input", async () => {
    expect(
      (
        await worker.fetch(
          req("/api/auth/sign-in/social", {
            provider: "github",
            extra: "x".repeat(5000),
          }),
          cfg,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await worker.fetch(
          req("/api/auth/sign-in/social", {
            provider: "github",
            newUserCallbackURL: "https://evil.test",
          }),
          cfg,
        )
      ).status,
    ).toBe(400);
  });

  it("atomically rate limits with pseudonymous buckets", async () => {
    const limiter = privateRateLimit(db, cfg.AUTH_SECRET!);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.consume("203.0.113.42|/api/auth/sign-in/social", {
          window: 60,
          max: 3,
        }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    const rows = (await db.prepare("SELECT * FROM hub_rate_limit").all())
      .results;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].bucket)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
  });
  it("cleans actual library timestamps while preserving active records", async () => {
    await invite();
    await login();
    await worker.fetch(
      req("/api/auth/sign-in/social", { provider: "github" }),
      cfg,
    );
    const session = await db
      .prepare("SELECT expiresAt FROM session")
      .first<{ expiresAt: string }>();
    const verification = await db
      .prepare("SELECT expiresAt FROM verification")
      .first<{ expiresAt: string }>();
    expect(typeof session!.expiresAt).toBe("string");
    expect(typeof verification!.expiresAt).toBe("string");
    expect(Date.parse(session!.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(verification!.expiresAt)).toBeGreaterThan(Date.now());
    await worker.scheduled({} as ScheduledController, cfg);
    expect(
      (await db.prepare("SELECT * FROM session").all()).results,
    ).toHaveLength(1);
    expect(
      (await db.prepare("SELECT * FROM verification").all()).results.length,
    ).toBeGreaterThan(0);
    vi.spyOn(Date, "now").mockReturnValue(
      Math.max(
        Date.parse(session!.expiresAt),
        Date.parse(verification!.expiresAt),
      ) + 1000,
    );
    try {
      await worker.scheduled({} as ScheduledController, cfg);
      for (const table of ["session", "verification", "hub_rate_limit"])
        expect(
          (await db.prepare(`SELECT * FROM ${table}`).all()).results,
        ).toHaveLength(0);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });
});
