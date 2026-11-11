/** Disabled-by-default product authorization and manual client credentials.
 * Not OAuth discovery or evidence of Dots/Vocs Code interoperability.
 */
import {
  hashLoginToken,
  readLoginSession,
  VOCS_ISSUER,
  type LoginEnv,
} from "./login/worker";
import { Fault, type Identity } from "./types";
import { boundedBody, digest } from "./security";
export interface CapabilityEnv extends LoginEnv {
  APP_MODE?: string;
  CAPABILITY_AUTH_ENABLED?: string;
}
const MAX_AGE = 300_000;
const allowed = ["models:read", "speech:write", "audio:read"];
const tokenPattern = /^vmcp_[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const headers = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
export function capabilityAuthEnabled(env: CapabilityEnv): boolean {
  return (
    env.CAPABILITY_AUTH_ENABLED === "true" &&
    env.APP_MODE === "production" &&
    env.PRODUCT_LOGIN_ENABLED === "true"
  );
}
function configured(
  req: Request,
  env: CapabilityEnv,
): { db: D1DatabaseSession; origin: string } {
  if (!capabilityAuthEnabled(env) || !env.LOGIN_DB)
    throw new Fault("capability_auth_not_enabled", 503);
  let origin: string;
  try {
    const url = new URL(env.PUBLIC_ORIGIN || "");
    if (url.protocol !== "https:" || url.origin !== env.PUBLIC_ORIGIN)
      throw Error();
    origin = url.origin;
  } catch {
    throw new Fault("capability_auth_not_enabled", 503);
  }
  if (new URL(req.url).origin !== origin) throw new Fault("invalid_host", 403);
  if (
    (req.headers.has("Origin") && req.headers.get("Origin") !== origin) ||
    req.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new Fault("invalid_origin", 403);
  // Always primary: a fresh request must observe logout/suspension/grant removal.
  return { db: env.LOGIN_DB.withSession("first-primary"), origin };
}
async function browser(req: Request, env: CapabilityEnv) {
  const context = configured(req, env);
  if (
    req.headers.has("Authorization") ||
    req.headers.has("Cf-Access-Jwt-Assertion")
  )
    throw new Fault("invalid_identity", 401);
  const session = await readLoginSession(req, context.db);
  if (!session) throw new Fault("authentication_required", 401);
  const permissions = await context.db
    .prepare(
      "SELECT permission FROM hub_login_permission WHERE issuer = ? AND subject = ?",
    )
    .bind(session.issuer, session.subject)
    .all<{ permission: string }>();
  const grants = permissions.results.map((row) => row.permission);
  if (!grants.includes("dashboard:manage"))
    throw new Fault("insufficient_scope", 403);
  return { ...context, session, grants };
}
/** Null means this credential kind is absent/disabled. Callers must not fall back after Fault. */
export async function readProductIdentity(
  req: Request,
  env: CapabilityEnv,
): Promise<Identity | null> {
  if (
    !capabilityAuthEnabled(env) ||
    !(req.headers.get("Cookie") || "")
      .split(";")
      .some((p) => p.trim().startsWith("__Host-mcp.session="))
  )
    return null;
  const path = new URL(req.url).pathname;
  if (path === "/openrouter") throw new Fault("authentication_required", 401);
  const { session, grants } = await browser(req, env);
  if (
    !["GET", "HEAD"].includes(req.method) &&
    !(
      req.method === "DELETE" &&
      (path === "/api/key" || path.startsWith("/api/audio/"))
    ) &&
    (session.authenticated_at <= Date.now() - MAX_AGE ||
      session.authenticated_at > Date.now() + 5000)
  )
    throw new Fault("fresh_authentication_required", 401);
  return {
    tenant: await digest(session.issuer + "\0" + session.subject),
    scopes: grants.filter((s) => allowed.includes(s)),
    dashboard: true,
  };
}
/** Only manually issued bearer credentials; cookies cannot substitute for a token. */
export async function readClientIdentity(
  req: Request,
  env: CapabilityEnv,
): Promise<Identity | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const { db, origin } = configured(req, env);
  const path = new URL(req.url).pathname;
  if (path !== "/openrouter" && !path.startsWith("/audio/"))
    throw new Fault("insufficient_scope", 403);
  const token = auth.match(/^Bearer (vmcp_[A-Za-z0-9_-]{43})$/)?.[1];
  if (
    !token ||
    !tokenPattern.test(token) ||
    req.headers.has("Cf-Access-Jwt-Assertion") ||
    (req.headers.get("Cookie") || "")
      .split(";")
      .some((p) => p.trim().startsWith("__Host-mcp.session="))
  )
    throw new Fault("invalid_identity", 401);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT t.issuer, t.subject, t.scopes FROM hub_client_token t
    JOIN hub_login_session s ON s.token_hash = t.session_hash AND s.issuer = t.issuer AND s.subject = t.subject
    JOIN hub_login_principal p ON p.issuer = s.issuer AND p.subject = s.subject
    WHERE t.token_hash = ? AND t.resource = ? AND t.issuer = ? AND t.revoked_at IS NULL
    AND t.expires_at > ? AND s.expires_at > ? AND s.authenticated_at > ? AND s.authenticated_at <= ? AND p.disabled_at IS NULL
    AND EXISTS (SELECT 1 FROM hub_login_permission g WHERE g.issuer = t.issuer AND g.subject = t.subject AND g.permission = 'dashboard:manage')
    AND NOT EXISTS (SELECT 1 FROM json_each(t.scopes) x WHERE NOT EXISTS
      (SELECT 1 FROM hub_login_permission g WHERE g.issuer = t.issuer AND g.subject = t.subject AND g.permission = x.value))`,
    )
    .bind(
      await hashLoginToken(token),
      origin + "/openrouter",
      VOCS_ISSUER,
      now,
      now,
      now - MAX_AGE,
      now + 5000,
    )
    .first<{ issuer: string; subject: string; scopes: string }>();
  if (!row) throw new Fault("invalid_identity", 401);
  const scopes: unknown = JSON.parse(row.scopes);
  if (
    !Array.isArray(scopes) ||
    !scopes.length ||
    !scopes.every((s) => typeof s === "string" && allowed.includes(s))
  )
    throw new Fault("invalid_identity", 401);
  return {
    tenant: await digest(row.issuer + "\0" + row.subject),
    scopes,
    dashboard: false,
  };
}
export async function handleClientManagement(
  req: Request,
  env: CapabilityEnv,
): Promise<Response | null> {
  const url = new URL(req.url);
  const revokeId = url.pathname.startsWith("/api/clients/")
    ? url.pathname.slice("/api/clients/".length)
    : null;
  if (url.pathname !== "/api/clients" && revokeId === null) return null;
  try {
    if (url.search || req.url.length > 2048) throw new Fault("invalid_request");
    const { db, origin, session } = await browser(req, env);
    if (req.method === "GET" && url.pathname === "/api/clients") {
      const rows = await db
        .prepare(
          `SELECT id, client_id AS clientId, scopes, resource, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt
        FROM hub_client_token WHERE issuer = ? AND subject = ? ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(session.issuer, session.subject)
        .all<{ scopes: string }>();
      return json({
        clients: rows.results.map((row) => ({
          ...row,
          scopes: JSON.parse(row.scopes),
        })),
      });
    }
    if (req.method !== (revokeId === null ? "POST" : "DELETE"))
      throw new Fault("method_not_allowed", 405);
    if (req.headers.get("Origin") !== origin)
      throw new Fault("invalid_origin", 403);
    if (req.headers.get("X-Vocs-Intent") !== "dashboard")
      throw new Fault("invalid_intent", 403);
    if (revokeId !== null) {
      if (
        !idPattern.test(revokeId) ||
        (await boundedBody(req, 64)).length !== 0
      )
        throw new Fault("invalid_request");
      const result = await db
        .prepare(
          "UPDATE hub_client_token SET revoked_at = ? WHERE id = ? AND issuer = ? AND subject = ? RETURNING id",
        )
        .bind(Date.now(), revokeId, session.issuer, session.subject)
        .first();
      if (!result) throw new Fault("not_found", 404);
      return json({ ok: true });
    }
    if (
      req.headers.get("Content-Type")?.split(";")[0].trim() !==
      "application/json"
    )
      throw new Fault("invalid_request");
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBody(req, 2048),
      ),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Fault("invalid_request");
    const body = value as Record<string, unknown>;
    if (
      Object.keys(body).length !== 3 ||
      !["dots", "vocs-code"].includes(body.clientId as string) ||
      body.consent !== true ||
      !Array.isArray(body.scopes) ||
      !body.scopes.length ||
      body.scopes.length > allowed.length ||
      new Set(body.scopes).size !== body.scopes.length ||
      !body.scopes.every((s) => typeof s === "string" && allowed.includes(s))
    )
      throw new Fault("invalid_request");
    const now = Date.now();
    if (
      session.authenticated_at <= now - MAX_AGE ||
      session.authenticated_at > now + 5000
    )
      throw new Fault("fresh_authentication_required", 401);
    const expiresAt = Math.min(
      now + MAX_AGE,
      session.expires_at,
      session.authenticated_at + MAX_AGE,
    );
    const id = crypto.randomUUID();
    const token =
      "vmcp_" +
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const scopes = JSON.stringify(body.scopes);
    // One SQL statement rechecks session, principal and every grant at commit. Logout
    // before insertion prevents issuance; logout after insertion cascades revocation.
    const result = await db
      .prepare(
        `INSERT INTO hub_client_token(id, token_hash, session_hash, issuer, subject, client_id, scopes, resource, created_at, expires_at)
      SELECT ?, ?, s.token_hash, s.issuer, s.subject, ?, ?, ?, ?, min(?, s.expires_at, s.authenticated_at + ?)
      FROM hub_login_session s JOIN hub_login_principal p ON p.issuer = s.issuer AND p.subject = s.subject
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.authenticated_at > ? AND s.authenticated_at <= ? AND p.disabled_at IS NULL
      AND EXISTS (SELECT 1 FROM hub_login_permission g WHERE g.issuer = s.issuer AND g.subject = s.subject AND g.permission = 'dashboard:manage')
      AND NOT EXISTS (SELECT 1 FROM json_each(?) x WHERE NOT EXISTS (SELECT 1 FROM hub_login_permission g WHERE g.issuer = s.issuer AND g.subject = s.subject AND g.permission = x.value))
      AND (SELECT COUNT(*) FROM hub_client_token t WHERE t.issuer = s.issuer AND t.subject = s.subject AND t.expires_at > ? AND t.revoked_at IS NULL) < 20
      RETURNING expires_at AS expiresAt`,
      )
      .bind(
        id,
        await hashLoginToken(token),
        body.clientId,
        scopes,
        origin + "/openrouter",
        now,
        expiresAt,
        MAX_AGE,
        session.token_hash,
        now,
        now - MAX_AGE,
        now + 5000,
        scopes,
        now,
      )
      .first<{ expiresAt: number }>();
    if (!result) throw new Fault("issuance_not_authorized", 403);
    return json(
      {
        id,
        token,
        clientId: body.clientId,
        scopes: body.scopes,
        resource: origin + "/openrouter",
        expiresAt: result.expiresAt,
      },
      201,
    );
  } catch (error) {
    return error instanceof Fault
      ? json({ error: error.code }, error.status)
      : json({ error: "request_failed" }, 400);
  }
}

export async function cleanupClients(env: CapabilityEnv): Promise<void> {
  if (!capabilityAuthEnabled(env) || !env.LOGIN_DB) return;
  await env.LOGIN_DB.prepare(
    "DELETE FROM hub_client_token WHERE expires_at <= ? OR revoked_at IS NOT NULL",
  )
    .bind(Date.now())
    .run();
}
