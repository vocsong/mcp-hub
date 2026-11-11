import { env } from "cloudflare:test";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  handleLogin,
  cleanupLogin,
  VOCS_ISSUER,
  PRODUCT_CLIENT,
  type LoginEnv,
} from "../src/login/worker";
import preview from "../src/preview-login";
import { identity } from "../src/security";
import type { Env } from "../src/types";
import schema from "../migrations/login/0001_product_sessions.sql?raw";
const db = (env as unknown as { LOGIN_DB: D1Database }).LOGIN_DB;
const origin = "https://mcp.vocs.io";
const cfg: LoginEnv = {
  PRODUCT_LOGIN_ENABLED: "true",
  PUBLIC_ORIGIN: origin,
  LOGIN_DB: db,
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
          headers: { origin, "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
  );
const run = async (request: Request, settings = cfg) =>
  (await handleLogin(request, settings))!;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .filter((v) => !v.includes("Max-Age=0"))
    .map((v) => v.split(";")[0])
    .join("; ");
async function start(cookie = "") {
  const response = await run(req("/login/start", {}, { cookie }));
  expect(response.status).toBe(200);
  const url = new URL(((await response.json()) as { url: string }).url);
  return {
    response,
    url,
    cookie: cookies(response),
    state: url.searchParams.get("state")!,
  };
}
const code = "c".repeat(43);
const callbackRequest = (flow: { state: string; cookie: string }, extra = "") =>
  req(
    "/login/callback?" +
      new URLSearchParams({ code, state: flow.state, iss: VOCS_ISSUER }) +
      extra,
    undefined,
    { cookie: flow.cookie },
  );
function mockIdentity(
  subject = "alice",
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      issuer: VOCS_ISSUER,
      audience: PRODUCT_CLIENT,
      subject,
      authenticated_at: new Date().toISOString(),
      ...overrides,
    }),
  );
}
async function login(subject = "alice", previous = "") {
  const flow = await start(previous);
  mockIdentity(subject);
  const result = await run(
    callbackRequest({
      ...flow,
      cookie: flow.cookie + (previous ? "; " + previous : ""),
    }),
  );
  expect(result.headers.get("Location")).toBe("/account");
  return { result, cookie: cookies(result), flow };
}
beforeAll(async () => {
  for (const statement of schema.split(";").filter((s) => s.trim()))
    await db.prepare(statement).run();
});
beforeEach(async () => {
  for (const table of [
    "hub_login_permission",
    "hub_login_session",
    "hub_login_transaction",
    "hub_login_principal",
    "hub_login_rate",
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
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
describe("shared Vocs Login", () => {
  it("cancel/logout revokes a committed callback whose cookie has not arrived", async () => {
    for (const path of ["/login/cancel", "/login/logout"]) {
      const flow = await start();
      mockIdentity();
      const committed = await run(callbackRequest(flow));
      expect(committed.headers.get("Location")).toBe("/account");
      // Model network delivery ordering: the browser still only has the flow cookie.
      await run(req(path, {}, { cookie: flow.cookie }));
      expect(
        (
          await run(
            req("/login/session", undefined, { cookie: cookies(committed) }),
          )
        ).status,
      ).toBe(401);
    }
  });

  it("fails closed without flag, database, or canonical HTTPS origin", async () => {
    for (const bad of [
      {},
      { ...cfg, PRODUCT_LOGIN_ENABLED: "false" },
      { ...cfg, LOGIN_DB: undefined },
      { ...cfg, PUBLIC_ORIGIN: "http://mcp.vocs.io" },
      { ...cfg, PUBLIC_ORIGIN: origin + "/" },
      { ...cfg, PUBLIC_ORIGIN: "https://user@mcp.vocs.io" },
    ])
      expect((await run(req("/login/start", {}), bad)).status).toBe(503);
    expect((await run(new Request("https://evil.test/login"))).status).toBe(
      400,
    );
  });
  it("pins exact authorize origin, client and callback with server-held S256 verifier", async () => {
    const flow = await start();
    expect(flow.url.origin).toBe(VOCS_ISSUER);
    expect(flow.url.pathname).toBe("/authorize");
    expect(flow.url.searchParams.get("redirect_uri")).toBe(
      origin + "/login/callback",
    );
    expect(flow.url.searchParams.get("client_id")).toBe(PRODUCT_CLIENT);
    expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
    const row = await db
      .prepare("SELECT * FROM hub_login_transaction")
      .first<{ state_hash: string; browser_hash: string; verifier: string }>();
    expect(row!.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.url.href).not.toContain(row!.verifier);
    expect(flow.cookie).not.toContain(row!.verifier);
    expect(row!.state_hash).not.toBe(flow.state);
    expect(flow.cookie).not.toContain(row!.browser_hash);
    const challenge = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(row!.verifier),
          ),
        ),
      ),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(flow.url.searchParams.get("code_challenge")).toBe(challenge);
    const setCookie = flow.response.headers.get("Set-Cookie")!;
    for (const property of [
      "__Host-mcp.login=",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=300",
    ])
      expect(setCookie).toContain(property);
    expect(setCookie).not.toMatch(/Domain=/i);
  });
  it("rejects cross-origin initiation, injected JSON and custom redirects", async () => {
    for (const headers of [
      { origin: "https://evil.test" },
      { "Sec-Fetch-Site": "cross-site" },
      { origin: "" },
    ])
      expect((await run(req("/login/start", {}, headers))).status).toBe(403);
    for (const body of [
      [],
      null,
      { redirect_uri: "https://evil.test" },
      { subject: "alice" },
      { x: "x".repeat(100) },
    ])
      expect((await run(req("/login/start", body))).status).toBe(400);
    expect(
      (await run(req("/login/start?returnTo=https://evil.test", {}))).status,
    ).toBe(400);
    expect((await run(req("/login/start"))).status).toBe(405);
  });
  it("rejects missing, wrong and duplicate browser cookies without exchanging", async () => {
    const flow = await start();
    for (const cookie of [
      "",
      "__Host-mcp.login=" + "x".repeat(43),
      flow.cookie + "; " + flow.cookie,
    ])
      expect(
        (await run(callbackRequest({ ...flow, cookie }))).headers.get(
          "Location",
        ),
      ).toBe("/login/error");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects wrong state, issuer, duplicate parameters and browser assertions", async () => {
    const flow = await start();
    for (const extra of [
      "&iss=" + encodeURIComponent(VOCS_ISSUER),
      "&state=" + flow.state,
      "&email=x",
      "&subject=alice",
    ])
      expect(
        (await run(callbackRequest(flow, extra))).headers.get("Location"),
      ).toBe("/login/error");
    for (const [name, value] of [
      ["state", "x".repeat(43)],
      ["iss", VOCS_ISSUER + "/"],
      ["iss", "https://evil.test"],
      ["code", "short"],
    ]) {
      const url = new URL(callbackRequest(flow).url);
      url.searchParams.set(name, value);
      expect(
        (
          await run(new Request(url, { headers: { cookie: flow.cookie } }))
        ).headers.get("Location"),
      ).toBe("/login/error");
    }
    expect(
      (
        await run(
          req("/login/callback", { issuer: VOCS_ISSUER, subject: "alice" }),
        )
      ).status,
    ).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("expires and cancels browser-bound transactions", async () => {
    const flow = await start();
    await db
      .prepare("UPDATE hub_login_transaction SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await run(callbackRequest(flow))).headers.get("Location")).toBe(
      "/login/error",
    );
    const newer = await start();
    expect(
      (await run(req("/login/cancel", {}, { cookie: newer.cookie }))).status,
    ).toBe(200);
    expect((await run(callbackRequest(newer))).headers.get("Location")).toBe(
      "/login/error",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("new initiation invalidates the previous browser transaction", async () => {
    const first = await start();
    const second = await start(first.cookie);
    expect(first.state).not.toBe(second.state);
    expect((await run(callbackRequest(first))).headers.get("Location")).toBe(
      "/login/error",
    );
    expect(
      (await db.prepare("SELECT * FROM hub_login_transaction").all()).results,
    ).toHaveLength(1);
  });
  it("exchanges once over pinned HTTPS without following redirects or sending cookies", async () => {
    const flow = await start();
    mockIdentity();
    const results = await Promise.all([
      run(callbackRequest(flow)),
      run(callbackRequest(flow)),
    ]);
    expect(
      results.filter((r) => r.headers.get("Location") === "/account"),
    ).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(VOCS_ISSUER + "/sso/token");
    expect(init?.redirect).toBe("manual");
    // Construct a real workerd Request, not just a mocked fetch init. The
    // unsupported redirect:error option otherwise passes mocked-fetch tests.
    expect(new Request(url, init).redirect).toBe("manual");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).has("Cookie")).toBe(false);
    expect(JSON.parse(init?.body as string)).toEqual({
      client_id: PRODUCT_CLIENT,
      redirect_uri: origin + "/login/callback",
      code,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect((await run(callbackRequest(flow))).headers.get("Location")).toBe(
      "/login/error",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 303, 307, 308])(
    "rejects identity HTTP %i without forwarding credentials or retrying",
    async (status) => {
      const flow = await start();
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        expect(new Request(input, init).redirect).toBe("manual");
        return new Response(null, {
          status,
          headers: { Location: "https://untrusted.example/token" },
        });
      });
      expect((await run(callbackRequest(flow))).headers.get("Location")).toBe(
        "/login/error",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        (await db
          .prepare("SELECT count(*) AS n FROM hub_login_session")
          .first<{ n: number }>())!.n,
      ).toBe(0);
    },
  );
  it.each([
    { issuer: VOCS_ISSUER + "/" },
    { issuer: "https://evil.test" },
    { audience: "other-product" },
    { subject: "" },
    { subject: "x".repeat(129) },
    { subject: "<script>" },
    { authenticated_at: "invalid" },
    { authenticated_at: new Date(Date.now() + 60000).toISOString() },
    { authenticated_at: new Date(Date.now() - 9 * 3600000).toISOString() },
    { email: "private@example.test" },
  ])("rejects malformed/mismatched assertion %j", async (overrides) => {
    const flow = await start();
    mockIdentity("alice", overrides);
    expect((await run(callbackRequest(flow))).headers.get("Location")).toBe(
      "/login/error",
    );
    expect(
      (await db.prepare("SELECT * FROM hub_login_session").all()).results,
    ).toHaveLength(0);
  });
  it("bounds malformed, oversized and non-JSON responses, and never retries exchange", async () => {
    for (const response of [
      new Response("x"),
      new Response("{"),
      Response.json({ x: "x".repeat(3000) }),
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.test" },
      }),
      Response.json({}, { status: 400 }),
    ]) {
      const flow = await start();
      vi.mocked(fetch).mockResolvedValue(response);
      expect((await run(callbackRequest(flow))).headers.get("Location")).toBe(
        "/login/error",
      );
    }
    const flow = await start();
    vi.mocked(fetch).mockRejectedValue(Error("private upstream error"));
    const failure = await run(callbackRequest(flow));
    expect(await failure.text()).not.toContain("private");
    const count = vi.mocked(fetch).mock.calls.length;
    await run(callbackRequest(flow));
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it("cancellation/logout while exchange is in flight prevents session creation", async () => {
    for (const path of ["/login/cancel", "/login/logout"]) {
      const flow = await start();
      let release!: () => void;
      let entered!: () => void;
      const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(fetch).mockImplementation(async () => {
        entered();
        await paused;
        return Response.json({
          issuer: VOCS_ISSUER,
          audience: PRODUCT_CLIENT,
          subject: "alice",
          authenticated_at: new Date().toISOString(),
        });
      });
      const pending = run(callbackRequest(flow));
      await arrived;
      await run(req(path, {}, { cookie: flow.cookie }));
      release();
      expect((await pending).headers.get("Location")).toBe("/login/error");
      expect(
        (await db.prepare("SELECT * FROM hub_login_session").all()).results,
      ).toHaveLength(0);
    }
  });
  it("creates hashed host-only product sessions and grants no permissions", async () => {
    const { cookie, result } = await login();
    const row = await db.prepare("SELECT * FROM hub_login_session").first<{
      token_hash: string;
      expires_at: number;
      issuer: string;
      subject: string;
    }>();
    expect(cookie).toContain("__Host-mcp.session=");
    expect(cookie).not.toContain(row!.token_hash);
    expect(row!.expires_at).toBeLessThanOrEqual(Date.now() + 1800000);
    expect(row!.issuer).toBe(VOCS_ISSUER);
    expect(row!.subject).toBe("alice");
    expect(result.headers.get("Set-Cookie")).toContain("Max-Age=1800");
    expect(result.headers.get("Set-Cookie")).not.toContain("Domain=");
    const account = await run(req("/login/session", undefined, { cookie }));
    expect(await account.json()).toMatchObject({
      subject: "alice",
      permissions: [],
      mcpAuthorized: false,
    });
    expect(
      (await db.prepare("SELECT * FROM hub_login_permission").all()).results,
    ).toHaveLength(0);
  });
  it("rotates product session on login and never merges subjects", async () => {
    const one = await login("alice");
    const two = await login("bob", one.cookie);
    expect(one.cookie).not.toBe(two.cookie);
    expect(
      (await run(req("/login/session", undefined, { cookie: one.cookie })))
        .status,
    ).toBe(401);
    expect(
      await (
        await run(req("/login/session", undefined, { cookie: two.cookie }))
      ).json(),
    ).toMatchObject({ subject: "bob" });
    expect(
      (await db.prepare("SELECT * FROM hub_login_principal").all()).results,
    ).toHaveLength(2);
  });
  it("logout affects only the current product session and never Vocs Login", async () => {
    const one = await login("alice");
    const two = await login("bob");
    vi.mocked(fetch).mockClear();
    expect(
      (
        await run(
          req(
            "/login/logout",
            {},
            { cookie: one.cookie, origin: "https://evil.test" },
          ),
        )
      ).status,
    ).toBe(403);
    const result = await run(req("/login/logout", {}, { cookie: one.cookie }));
    expect(result.status).toBe(200);
    expect(result.headers.get("Set-Cookie")).not.toContain("vocs");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await run(req("/login/session", undefined, { cookie: one.cookie })))
        .status,
    ).toBe(401);
    expect(
      (await run(req("/login/session", undefined, { cookie: two.cookie })))
        .status,
    ).toBe(200);
  });
  it("revokes disabled principals immediately, prevents re-login and expires fixed sessions", async () => {
    const one = await login();
    await db
      .prepare(
        "UPDATE hub_login_principal SET disabled_at = ? WHERE subject = ?",
      )
      .bind(Date.now(), "alice")
      .run();
    expect(
      (await run(req("/login/session", undefined, { cookie: one.cookie })))
        .status,
    ).toBe(401);
    const flow = await start();
    mockIdentity();
    expect((await run(callbackRequest(flow))).headers.get("Location")).toBe(
      "/login/error",
    );
    const bob = await login("bob");
    await db
      .prepare("UPDATE hub_login_session SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect(
      (await run(req("/login/session", undefined, { cookie: bob.cookie })))
        .status,
    ).toBe(401);
    await cleanupLogin(cfg);
    expect(
      (await db.prepare("SELECT * FROM hub_login_session").all()).results,
    ).toHaveLength(0);
  });
  it("local permission rows and browser sessions never authorize the MCP backend", async () => {
    const one = await login();
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?, ?, ?)")
      .bind(VOCS_ISSUER, "alice", "dashboard:manage")
      .run();
    expect(
      await (
        await run(req("/login/session", undefined, { cookie: one.cookie }))
      ).json(),
    ).toMatchObject({ permissions: [], mcpAuthorized: false });
    await expect(
      identity(req("/openrouter", undefined, { cookie: one.cookie }), {
        ...(env as Env),
        APP_MODE: "production",
        PUBLIC_ORIGIN: origin,
        AUTH_ISSUER: VOCS_ISSUER,
        AUTH_AUDIENCE: PRODUCT_CLIENT,
        AUTH_JWKS_URL: VOCS_ISSUER + "/jwks",
        INVITED_SUBJECTS: "alice",
      }),
    ).rejects.toThrow("authentication_required");
    expect(
      (await preview.fetch(req("/api/key", {}, { cookie: one.cookie }), cfg))
        .status,
    ).toBe(405);
    expect(
      (
        await preview.fetch(
          req("/openrouter", undefined, { cookie: one.cookie }),
          cfg,
        )
      ).status,
    ).toBe(503);
  });
  it("limits start traffic atomically without retaining IP addresses", async () => {
    await db
      .prepare("INSERT INTO hub_login_rate VALUES (1, ?, 119)")
      .bind(Math.floor(Date.now() / 60000))
      .run();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        run(req("/login/start", {}, { "CF-Connecting-IP": "203.0.113.1" })),
      ),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
    expect(
      JSON.stringify(
        (await db.prepare("SELECT * FROM hub_login_rate").all()).results,
      ),
    ).not.toContain("203.0.113");
  });
  it("keeps login UI private, inert until enabled and independent of mock CSP", async () => {
    expect((await preview.fetch(req("/login"), {})).status).toBe(503);
    const login = await preview.fetch(req("/login"), cfg);
    expect(login.status).toBe(200);
    const html = await login.text();
    expect(html).toContain("Continue with Vocs Login");
    expect(html).not.toContain("<style");
    expect(html).toContain('aria-live="polite"');
    expect(login.headers.get("Cache-Control")).toBe("no-store");
    expect(login.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(login.headers.get("Content-Security-Policy")).not.toContain(
      "unsafe-inline",
    );
    expect(
      await (await preview.fetch(req("/health"), cfg)).json(),
    ).toMatchObject({
      serverStorage: true,
      productLogin: "identity-only",
      mcpAuthorized: false,
      liveProvider: false,
    });
    const mock = await preview.fetch(req("/"), cfg);
    expect(mock.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'none'",
    );
    expect(await mock.text()).toContain(
      "No sign-in, real keys, API calls or charges",
    );
  });
});
