/** First-party Vocs identity handoff. Not OIDC, MCP OAuth, or a capability grant. */
import { loginHtml, accountHtml, loginScript, loginCss } from "./ui";
export interface LoginEnv {
  PRODUCT_LOGIN_ENABLED?: string;
  PUBLIC_ORIGIN?: string;
  LOGIN_DB?: D1Database;
}
export const VOCS_ISSUER = "https://auth.vocs.io";
export const PRODUCT_CLIENT = "mcp-hub";
const STATE_COOKIE = "__Host-mcp.login";
const SESSION_COOKIE = "__Host-mcp.session";
const FLOW_MS = 5 * 60_000;
const SESSION_MS = 30 * 60_000;
const SOURCE_SESSION_MS = 8 * 60 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const headers = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const response = (
  body: BodyInit | null,
  status = 200,
  more: HeadersInit = {},
) => new Response(body, { status, headers: { ...headers, ...more } });
const json = (value: unknown, status = 200) =>
  response(JSON.stringify(value), status, {
    "Content-Type": "application/json",
  });
const redirect = (path: string) => response(null, 303, { Location: path });
const cookie = (name: string, value: string, seconds: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
function readCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("Cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return TOKEN.test(value) ? value : null;
}
function base64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function hashLoginToken(value: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
function origin(env: LoginEnv): string | null {
  try {
    const url = new URL(env.PUBLIC_ORIGIN || "");
    return url.protocol === "https:" && url.origin === env.PUBLIC_ORIGIN
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<unknown> {
  const reader = body?.getReader();
  if (!reader) throw Error("missing_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw Error("large_body");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
}
function sameOrigin(request: Request, expected: string): boolean {
  return (
    request.headers.get("Origin") === expected &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
}
function emptyObject(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
export interface LoginSession {
  token_hash: string;
  issuer: string;
  subject: string;
  authenticated_at: number;
  expires_at: number;
}
export async function readLoginSession(
  request: Request,
  db: D1Database | D1DatabaseSession,
): Promise<LoginSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db
    .prepare(
      `SELECT s.token_hash, s.issuer, s.subject, s.authenticated_at, s.expires_at
    FROM hub_login_session s JOIN hub_login_principal p ON p.issuer = s.issuer AND p.subject = s.subject
    WHERE s.token_hash = ? AND s.issuer = ? AND s.expires_at > ? AND p.disabled_at IS NULL`,
    )
    .bind(await hashLoginToken(token), VOCS_ISSUER, Date.now())
    .first<LoginSession>();
}
async function start(
  request: Request,
  db: D1Database,
  productOrigin: string,
): Promise<Response> {
  // A single bounded, anonymous counter protects database growth. No IP/user-agent storage.
  const window = Math.floor(Date.now() / 60_000);
  const limited = await db
    .prepare(
      `INSERT INTO hub_login_rate(id, window, count) VALUES (1, ?, 1)
    ON CONFLICT(id) DO UPDATE SET window = excluded.window,
    count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END
    WHERE window != excluded.window OR count < 120 RETURNING count`,
    )
    .bind(window)
    .first();
  if (!limited) return json({ error: "try_later" }, 429);
  const state = random(),
    browser = random(),
    verifier = random();
  const previous = readCookie(request, STATE_COOKIE);
  await db.batch([
    db
      .prepare("DELETE FROM hub_login_session WHERE browser_hash = ?")
      .bind(previous ? await hashLoginToken(previous) : ""),
    db
      .prepare(
        "DELETE FROM hub_login_transaction WHERE browser_hash = ? OR expires_at <= ?",
      )
      .bind(previous ? await hashLoginToken(previous) : "", Date.now()),
    db
      .prepare(
        "INSERT INTO hub_login_transaction(state_hash, browser_hash, verifier, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(
        await hashLoginToken(state),
        await hashLoginToken(browser),
        verifier,
        Date.now() + FLOW_MS,
      ),
  ]);
  const destination = new URL("/authorize", VOCS_ISSUER);
  destination.search = new URLSearchParams({
    client_id: PRODUCT_CLIENT,
    redirect_uri: productOrigin + "/login/callback",
    state,
    code_challenge: await hashLoginToken(verifier),
    code_challenge_method: "S256",
  }).toString();
  const result = json({ url: destination.href });
  result.headers.append(
    "Set-Cookie",
    cookie(STATE_COOKIE, browser, FLOW_MS / 1000),
  );
  return result;
}
async function callback(
  request: Request,
  db: D1Database,
  productOrigin: string,
): Promise<Response> {
  const failed = () => {
    const result = redirect("/login/error");
    result.headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
    return result;
  };
  try {
    const url = new URL(request.url);
    const params = url.searchParams;
    const names = [...params.keys()];
    const browser = readCookie(request, STATE_COOKIE);
    if (
      names.length !== 3 ||
      !["code", "state", "iss"].every(
        (key) => params.getAll(key).length === 1,
      ) ||
      params.get("iss") !== VOCS_ISSUER ||
      !TOKEN.test(params.get("code") || "") ||
      !TOKEN.test(params.get("state") || "") ||
      !browser
    )
      return failed();
    // Atomic claim happens before the external exchange: duplicate callbacks never fetch twice.
    const transaction = await db
      .prepare(
        "UPDATE hub_login_transaction SET claimed = 1 WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? AND claimed = 0 RETURNING verifier",
      )
      .bind(
        await hashLoginToken(params.get("state")!),
        await hashLoginToken(browser),
        Date.now(),
      )
      .first<{ verifier: string }>();
    if (!transaction) return failed();
    const exchange = await fetch(VOCS_ISSUER + "/sso/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: PRODUCT_CLIENT,
        redirect_uri: productOrigin + "/login/callback",
        code: params.get("code"),
        code_verifier: transaction.verifier,
      }),
    });
    if (
      !exchange.ok ||
      exchange.headers.get("Content-Type")?.split(";")[0].trim() !==
        "application/json"
    ) {
      await exchange.body?.cancel();
      return failed();
    }
    const assertion = await boundedJson(exchange.body, 2048);
    if (!assertion || typeof assertion !== "object" || Array.isArray(assertion))
      return failed();
    const value = assertion as Record<string, unknown>;
    if (
      Object.keys(value).length !== 4 ||
      value.issuer !== VOCS_ISSUER ||
      value.audience !== PRODUCT_CLIENT ||
      typeof value.subject !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value.subject) ||
      typeof value.authenticated_at !== "string"
    )
      return failed();
    const authenticated = Date.parse(value.authenticated_at);
    const now = Date.now();
    if (
      !Number.isFinite(authenticated) ||
      authenticated > now + 5000 ||
      authenticated <= now - SOURCE_SESSION_MS
    )
      return failed();
    const expires = Math.min(
      now + SESSION_MS,
      authenticated + SOURCE_SESSION_MS,
    );
    const token = random();
    const previous = readCookie(request, SESSION_COOKIE);
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO hub_login_principal(issuer, subject) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM hub_login_transaction WHERE state_hash = ? AND browser_hash = ? AND claimed = 1 AND expires_at > ?) ON CONFLICT DO NOTHING",
        )
        .bind(
          VOCS_ISSUER,
          value.subject,
          await hashLoginToken(params.get("state")!),
          await hashLoginToken(browser),
          Date.now(),
        ),
      db
        .prepare(
          `INSERT INTO hub_login_session(token_hash, browser_hash, issuer, subject, authenticated_at, expires_at)
        SELECT ?, ?, issuer, subject, ?, ? FROM hub_login_principal WHERE issuer = ? AND subject = ? AND disabled_at IS NULL
        AND EXISTS (SELECT 1 FROM hub_login_transaction WHERE state_hash = ? AND browser_hash = ? AND claimed = 1 AND expires_at > ?)`,
        )
        .bind(
          await hashLoginToken(token),
          await hashLoginToken(browser),
          authenticated,
          expires,
          VOCS_ISSUER,
          value.subject,
          await hashLoginToken(params.get("state")!),
          await hashLoginToken(browser),
          Date.now(),
        ),
      db
        .prepare(
          "DELETE FROM hub_login_transaction WHERE state_hash = ? AND browser_hash = ?",
        )
        .bind(
          await hashLoginToken(params.get("state")!),
          await hashLoginToken(browser),
        ),
      db
        .prepare(
          "DELETE FROM hub_login_session WHERE token_hash = ? AND EXISTS (SELECT 1 FROM hub_login_session WHERE token_hash = ?)",
        )
        .bind(
          previous ? await hashLoginToken(previous) : "",
          await hashLoginToken(token),
        ),
    ]);
    if (results[1].meta.changes !== 1) return failed();
    const result = redirect("/account");
    result.headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
    result.headers.append(
      "Set-Cookie",
      cookie(SESSION_COOKIE, token, Math.floor((expires - now) / 1000)),
    );
    return result;
  } catch {
    return failed();
  } // Never log codes, verifier, cookies, profile, or provider errors.
}
const paths = new Set([
  "/login",
  "/login/error",
  "/login/start",
  "/login/callback",
  "/login/cancel",
  "/login/logout",
  "/account",
  "/login/session",
  "/login/ui.js",
  "/login/ui.css",
]);
export async function handleLogin(
  request: Request,
  env: LoginEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!paths.has(url.pathname)) return null;
  const productOrigin = origin(env);
  if (env.PRODUCT_LOGIN_ENABLED !== "true" || !env.LOGIN_DB || !productOrigin)
    return json({ error: "product_login_not_enabled" }, 503);
  if (url.origin !== productOrigin || request.url.length > 2048)
    return json({ error: "invalid_request" }, 400);
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== productOrigin
  )
    return json({ error: "invalid_origin" }, 403);
  if (url.pathname !== "/login/callback" && url.search)
    return json({ error: "invalid_request" }, 400);
  try {
    if (request.method === "GET") {
      if (url.pathname === "/login/callback")
        return callback(request, env.LOGIN_DB, productOrigin);
      if (url.pathname === "/login/session") {
        const active = await readLoginSession(request, env.LOGIN_DB);
        return active
          ? json({
              subject: active.subject,
              issuer: active.issuer,
              expiresAt: active.expires_at,
              mcpAuthorized: false,
              permissions: [],
            })
          : json({ error: "sign_in_required" }, 401);
      }
      const page =
        url.pathname === "/login" || url.pathname === "/login/error"
          ? loginHtml(url.pathname === "/login/error")
          : url.pathname === "/account"
            ? accountHtml
            : null;
      if (page)
        return response(page, 200, {
          "Content-Type": "text/html; charset=utf-8",
        });
      if (url.pathname === "/login/ui.js")
        return response(loginScript, 200, {
          "Content-Type": "text/javascript",
        });
      if (url.pathname === "/login/ui.css")
        return response(loginCss, 200, { "Content-Type": "text/css" });
    }
    if (
      request.method === "POST" &&
      ["/login/start", "/login/logout", "/login/cancel"].includes(url.pathname)
    ) {
      if (!sameOrigin(request, productOrigin))
        return json({ error: "invalid_origin" }, 403);
      if (
        request.headers.get("Content-Type")?.split(";")[0].trim() !==
          "application/json" ||
        !emptyObject(await boundedJson(request.body, 64))
      )
        return json({ error: "invalid_request" }, 400);
      if (url.pathname === "/login/start")
        return start(request, env.LOGIN_DB, productOrigin);
      const browser = readCookie(request, STATE_COOKIE);
      const token =
        url.pathname === "/login/logout"
          ? readCookie(request, SESSION_COOKIE)
          : null;
      // Keep the flow association on sessions until expiry: cancellation also wins
      // when a callback committed but its Set-Cookie has not reached the browser yet.
      await env.LOGIN_DB.batch([
        env.LOGIN_DB.prepare(
          "DELETE FROM hub_login_transaction WHERE browser_hash = ?",
        ).bind(browser ? await hashLoginToken(browser) : ""),
        env.LOGIN_DB.prepare(
          "DELETE FROM hub_login_session WHERE browser_hash = ? OR token_hash = ?",
        ).bind(
          browser ? await hashLoginToken(browser) : "",
          token ? await hashLoginToken(token) : "",
        ),
      ]);
      const result = json({ ok: true });
      result.headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
      if (url.pathname === "/login/logout")
        result.headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
      return result;
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch {
    return json({ error: "request_failed" }, 400);
  }
}
export async function cleanupLogin(env: LoginEnv): Promise<void> {
  if (!env.LOGIN_DB) return;
  await env.LOGIN_DB.batch([
    env.LOGIN_DB.prepare(
      "DELETE FROM hub_login_transaction WHERE expires_at <= ?",
    ).bind(Date.now()),
    env.LOGIN_DB.prepare(
      "DELETE FROM hub_login_session WHERE expires_at <= ?",
    ).bind(Date.now()),
  ]);
}
