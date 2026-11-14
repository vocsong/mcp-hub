import { selectLoginProfile, capabilityScopes } from "./login/profile";
/** Disabled-by-default OAuth trial. Protocol cryptography/lifecycle belongs to the official library.
 * D1 guards add primary-consistent source-session, consent and redemption/revocation checks.
 */
import {
  OAuthAuthorizationServer,
  OAuthResourceServer,
  OAuthError,
  AuthorizationError,
  insufficientScope,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import {
  readLoginSession,
  hashLoginToken,
  type LoginEnv,
} from "./login/worker";
import { boundedBody, digest } from "./security";
import { Fault, type Identity } from "./types";
export interface OAuthEnv extends LoginEnv {
  APP_MODE?: string;
  CAPABILITY_AUTH_ENABLED?: string;
  OAUTH_ENABLED?: string;
  OAUTH_DCR_ENABLED?: string;
  OAUTH_KV?: KVNamespace;
}
const age = 300_000;
const safeHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: safeHeaders });
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function oauthEnabled(env: OAuthEnv) {
  return (
    env.CAPABILITY_AUTH_ENABLED === "true" &&
    env.OAUTH_ENABLED === "true" &&
    env.APP_MODE === "production" &&
    env.PRODUCT_LOGIN_ENABLED === "true"
  );
}
function originCheck(req: Request, origin: string) {
  if (
    req.headers.get("Origin") !== origin ||
    req.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new Fault("invalid_origin", 403);
}
function scopeCheck(auth: AuthRequest, resource: string, allowed: string[]) {
  if (
    auth.codeChallengeMethod !== "S256" ||
    !auth.codeChallenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge)
  )
    throw new Fault("invalid_request");
  if (auth.resource !== resource) throw new Fault("invalid_target");
  if (
    !auth.scope.includes("models:read") ||
    auth.scope.some((s) => !allowed.includes(s))
  )
    throw new Fault("invalid_scope");
}
// This predicate is repeated inside writes, not merely checked before them.
const current = `EXISTS (SELECT 1 FROM hub_login_session s JOIN hub_login_principal p ON p.issuer=s.issuer AND p.subject=s.subject
 WHERE s.token_hash=hub_oauth_grant.session_hash AND s.issuer=hub_oauth_grant.issuer AND s.subject=hub_oauth_grant.subject
 AND p.disabled_at IS NULL AND s.expires_at > ? AND s.authenticated_at > ? AND s.authenticated_at <= ?)
 AND NOT EXISTS (SELECT 1 FROM json_each(hub_oauth_grant.scopes) x WHERE NOT EXISTS
 (SELECT 1 FROM hub_login_permission p WHERE p.issuer=hub_oauth_grant.issuer AND p.subject=hub_oauth_grant.subject AND p.permission=x.value))`;
type Guard = {
  id: string;
  issuer: string;
  subject: string;
  client_id: string;
  resource: string;
  scopes: string;
  expires_at: number;
};
export async function handleOAuth(
  req: Request,
  env: OAuthEnv,
  ctx: ExecutionContext,
  authorizedHandler: (who: Identity) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(req.url),
    path = url.pathname;
  const owns =
    path.startsWith("/oauth/") ||
    path.startsWith("/.well-known/oauth-") ||
    path === "/api/oauth/grants" ||
    path.startsWith("/api/oauth/grants/") ||
    path === "/openrouter" ||
    path.startsWith("/openrouter/");
  if (!owns || !oauthEnabled(env)) return null;
  try {
    const profile = selectLoginProfile(env);
    if (!profile) throw new Fault("oauth_not_configured", 503);
    const origin = profile.origin;
    const allowed = capabilityScopes(profile);
    if (
      !env.LOGIN_DB ||
      !env.OAUTH_KV ||
      new URL(origin).protocol !== "https:" ||
      new URL(origin).origin !== origin
    )
      throw new Fault("oauth_not_configured", 503);
    if (url.origin !== origin) throw new Fault("invalid_host", 403);
    const resource = origin + "/openrouter",
      db = env.LOGIN_DB.withSession("first-primary");
    let issuing: { id: string; clientId: string } | undefined;
    const server = new OAuthAuthorizationServer<OAuthEnv>({
      issuer: origin,
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      resources: [resource],
      defaultResource: resource,
      accessTokenTTL: 300,
      refreshTokenTTL: 0,
      scopesSupported: allowed,
      allowTokenExchangeGrant: false,
      clientIdMetadataDocumentEnabled: true,
      ...(env.OAUTH_DCR_ENABLED === "true"
        ? {
            clientRegistrationEndpoint: "/oauth/register",
            clientRegistrationTTL: 86400,
          }
        : {}),
      onError: ({ code, status, headers }) =>
        Response.json(
          { error: code, error_description: "OAuth request rejected" },
          { status, headers: { ...headers, ...safeHeaders } },
        ),
      clientRegistrationCallback: async ({ clientMetadata: m }) => {
        if (
          m.token_endpoint_auth_method !== "none" ||
          m.software_statement ||
          m.jwks_uri ||
          m.jwks ||
          (m.grant_types &&
            JSON.stringify(m.grant_types) !== '["authorization_code"]') ||
          (m.response_types && JSON.stringify(m.response_types) !== '["code"]')
        )
          return {
            description: "Only public authorization-code clients are supported",
          };
        for (const [id, window, limit] of [
          [1, Math.floor(Date.now() / 60000), 10],
          [2, Math.floor(Date.now() / 86400000), 1000],
        ]) {
          const ok = await db
            .prepare(
              `INSERT INTO hub_oauth_rate VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END WHERE window!=excluded.window OR count < ? RETURNING count`,
            )
            .bind(id, window, limit)
            .first();
          if (!ok)
            return {
              code: "temporarily_unavailable",
              description: "Registration limit reached",
              status: 429,
            };
        }
      },
      tokenExchangeCallback: async (o) => {
        if (
          o.grantType !== "authorization_code" ||
          typeof o.props?.bridgeId !== "string" ||
          o.resource !== resource
        )
          throw new OAuthError("invalid_grant", {
            description: "Grant is unavailable",
          });
        const now = Date.now();
        const row = await db
          .prepare(
            `UPDATE hub_oauth_grant SET exchanged=1 WHERE id=? AND client_id=? AND resource=? AND issuer=? AND exchanged=0 AND revoked_at IS NULL AND expires_at>=? AND ${current} RETURNING *`,
          )
          .bind(
            o.props.bridgeId,
            o.clientId,
            resource,
            profile.issuer,
            now + 60000,
            now + 60000,
            now - age + 60000,
            now + 5000,
          )
          .first<Guard>();
        if (
          !row ||
          (await digest(row.issuer + "\0" + row.subject)) !== o.userId ||
          o.requestedScope.some(
            (s) => !allowed.includes(s) || !JSON.parse(row.scopes).includes(s),
          )
        )
          throw new OAuthError("invalid_grant", {
            description: "Grant is unavailable",
          });
        issuing = { id: row.id, clientId: o.clientId };
        return {
          accessTokenTTL: Math.min(
            300,
            Math.floor((row.expires_at - now) / 1000),
          ),
          refreshTokenTTL: 0,
          accessTokenScope: o.requestedScope,
        };
      },
    });
    const api = server.getOAuthApi(env);
    const rs = new OAuthResourceServer<OAuthEnv, Identity>({
      resourceMetadata: {
        resource,
        authorization_servers: [origin],
        resource_name: "Vocs OpenRouter",
      },
      requiredScopes: ["models:read"],
      validateToken: () => async (r, t) => {
        const token = await server.validateToken<{ bridgeId: string }>(
          r,
          t,
          env,
        );
        if (!token || typeof token.props?.bridgeId !== "string") return null;
        const mapping = await db
          .prepare(
            "SELECT grant_id FROM hub_oauth_token WHERE token_hash=? AND grant_id=? AND client_id=?",
          )
          .bind(await hashLoginToken(t), token.props.bridgeId, token.clientId)
          .first();
        if (!mapping) return null;
        const now = Date.now();
        const row = await db
          .prepare(
            `SELECT * FROM hub_oauth_grant WHERE id=? AND client_id=? AND resource=? AND issuer=? AND exchanged=1 AND revoked_at IS NULL AND expires_at>? AND ${current}`,
          )
          .bind(
            token.props.bridgeId,
            token.clientId,
            r,
            profile.issuer,
            now,
            now,
            now - age,
            now + 5000,
          )
          .first<Guard>();
        if (
          !row ||
          token.userId !== (await digest(row.issuer + "\0" + row.subject)) ||
          token.scope.some(
            (s) => !allowed.includes(s) || !JSON.parse(row.scopes).includes(s),
          )
        )
          return null;
        return {
          ...token,
          props: {
            tenant: token.userId,
            scopes: token.scope,
            dashboard: false,
          },
        };
      },
      handler: {
        fetch: async (request, _env, context) => {
          const required = ["models:read"];
          if (path.startsWith("/openrouter/audio/"))
            required.push("audio:read");
          if (request.method === "POST") {
            const raw = await boundedBody(request.clone() as Request);
            try {
              const body = JSON.parse(new TextDecoder().decode(raw));
              if (
                body.method === "tools/call" &&
                body.params?.name === "openrouter_speech"
              )
                required.push("speech:write");
            } catch {}
          }
          if (required.some((s) => !context.auth.scope.includes(s)))
            return insufficientScope(context.auth, required);
          return authorizedHandler(context.props);
        },
      },
    });
    if (path === "/openrouter" || path.startsWith("/openrouter/")) {
      if (
        (req.headers.has("Origin") && req.headers.get("Origin") !== origin) ||
        req.headers.get("Sec-Fetch-Site") === "cross-site"
      )
        throw new Fault("invalid_origin", 403);
      if (
        req.headers.has("Cookie") ||
        req.headers.has("Cf-Access-Jwt-Assertion")
      )
        throw new Fault("invalid_identity", 401);
    }
    if (
      path === "/openrouter" ||
      path.startsWith("/openrouter/") ||
      path.startsWith("/.well-known/oauth-protected-resource")
    )
      return await rs.fetch(req, env, ctx);
    if (path === "/oauth/authorize" || path.startsWith("/api/oauth/grants")) {
      if (
        req.headers.has("Authorization") ||
        req.headers.has("Cf-Access-Jwt-Assertion")
      )
        throw new Fault("invalid_identity", 401);
      if (req.method !== "GET") originCheck(req, origin);
      const session = await readLoginSession(req, db, env);
      if (!session)
        return new Response(
          '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title><p><a href="/login">Sign in</a>, then restart authorization from your client.</p>',
          {
            status: 401,
            headers: {
              ...safeHeaders,
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy":
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            },
          },
        );
      if (path.startsWith("/api/oauth/grants")) {
        if (req.method === "GET" && path === "/api/oauth/grants") {
          const rows = await db
            .prepare(
              "SELECT id,client_id,scopes,resource,created_at,expires_at,revoked_at FROM hub_oauth_grant WHERE issuer=? AND subject=? ORDER BY created_at DESC LIMIT 100",
            )
            .bind(session.issuer, session.subject)
            .all();
          return json({
            grants: rows.results.map((r: any) => ({
              id: r.id,
              clientId: r.client_id,
              scopes: JSON.parse(r.scopes),
              resource: r.resource,
              createdAt: r.created_at,
              expiresAt: r.expires_at,
              revokedAt: r.revoked_at,
            })),
          });
        }
        if (
          req.method === "DELETE" &&
          /^\/api\/oauth\/grants\/[a-f0-9-]{36}$/.test(path)
        ) {
          await db
            .prepare(
              "UPDATE hub_oauth_grant SET revoked_at=? WHERE id=? AND issuer=? AND subject=?",
            )
            .bind(
              Date.now(),
              path.split("/").pop(),
              session.issuer,
              session.subject,
            )
            .run();
          return json({ revoked: true });
        }
        throw new Fault("method_not_allowed", 405);
      }
      const now = Date.now(),
        expiry = Math.min(session.expires_at, session.authenticated_at + age);
      if (expiry < now + 60000 || session.authenticated_at > now + 5000)
        throw new Fault("fresh_authentication_required", 401);
      const grants = (
        await db
          .prepare(
            "SELECT permission FROM hub_login_permission WHERE issuer=? AND subject=?",
          )
          .bind(session.issuer, session.subject)
          .all<{ permission: string }>()
      ).results.map((x) => x.permission);
      if (req.method === "GET") {
        const auth = await api.parseAuthRequest(req);
        scopeCheck(auth, resource, allowed);
        if (auth.scope.some((s) => !grants.includes(s)))
          throw new Fault("invalid_scope", 403);
        const description = await api.describeConsent(auth);
        await db
          .prepare("DELETE FROM hub_oauth_consent WHERE expires_at<=?")
          .bind(now)
          .run();
        const reservation = await hashLoginToken(crypto.randomUUID());
        const inserted = await db
          .prepare(
            `INSERT INTO hub_oauth_consent(handle_hash,session_hash,requested,expires_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM hub_oauth_consent WHERE session_hash=?)<20 RETURNING handle_hash`,
          )
          .bind(
            reservation,
            session.token_hash,
            JSON.stringify(auth.scope),
            Math.min(expiry, now + 300000),
            session.token_hash,
          )
          .first();
        if (!inserted) throw new Fault("try_later", 429);
        const transaction = await api.beginConsent(auth);
        await db
          .prepare(
            "UPDATE hub_oauth_consent SET handle_hash=? WHERE handle_hash=? AND session_hash=?",
          )
          .bind(
            await hashLoginToken(transaction.handle),
            reservation,
            session.token_hash,
          )
          .run();
        const h = new Headers(transaction.headers);
        Object.entries(safeHeaders).forEach(([k, v]) => h.set(k, v));
        h.set("Content-Type", "text/html; charset=utf-8");
        h.set(
          "Content-Security-Policy",
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        return new Response(
          `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Vocs MCP</title><h1>Authorize ${esc(description.clientName)}</h1><p>${description.clientDomain ? "Verified client domain: " + esc(description.clientDomain) : "Client name is self-asserted and unverified."}</p><p>Redirect destination: ${esc(description.redirectHost)}</p><p>${esc(description.redirectUri)}</p>${description.redirectIsLoopback ? "<p>Any local process could be listening at this loopback address.</p>" : ""}<p>Resource: ${esc(resource)}</p><p>Access ends within five minutes of source sign-in. No dashboard access or refresh token. ${profile.name === "staging" ? "This staging service lists models only. It cannot execute speech, paid requests or audio operations." : "Speech still requires your separate exact-text approval; this consent does not execute a provider request."}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${esc(transaction.handle)}">${auth.scope.map((s) => `<label><input type="checkbox" name="scope" value="${esc(s)}" checked>${esc(s)}</label><br>`).join("")}<button name="decision" value="approve">Approve selected scopes</button><button name="decision" value="deny">Deny</button></form>`,
          { headers: h },
        );
      }
      if (
        req.method !== "POST" ||
        req.headers.get("Content-Type")?.split(";")[0] !==
          "application/x-www-form-urlencoded"
      )
        throw new Fault("invalid_request");
      const form = new URLSearchParams(
        new TextDecoder().decode(await boundedBody(req, 8192)),
      );
      if (
        form.getAll("handle").length !== 1 ||
        form.getAll("decision").length !== 1
      )
        throw new Fault("invalid_request");
      const handle = form.get("handle")!,
        selected = [...new Set(form.getAll("scope"))];
      const binding = await db
        .prepare(
          "UPDATE hub_oauth_consent SET consumed=1 WHERE handle_hash=? AND session_hash=? AND consumed=0 AND expires_at>? RETURNING requested",
        )
        .bind(await hashLoginToken(handle), session.token_hash, now)
        .first<{ requested: string }>();
      if (!binding) throw new Fault("invalid_request");
      if (form.get("decision") === "deny") {
        const denied = await api.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      if (
        form.get("decision") !== "approve" ||
        !selected.includes("models:read") ||
        selected.some(
          (s) =>
            !allowed.includes(s) ||
            !grants.includes(s) ||
            !JSON.parse(binding.requested).includes(s),
        )
      )
        throw new Fault("invalid_scope");
      const approved = await api.approveConsent(req, handle, {
        scope: selected,
      });
      scopeCheck(approved.request, resource, allowed);
      const id = crypto.randomUUID();
      // Atomically require the exact source session, current principal and every selected grant.
      const inserted = await db
        .prepare(
          `INSERT INTO hub_oauth_grant SELECT ?,s.token_hash,s.issuer,s.subject,?,?,?,?,?,0,NULL
 FROM hub_login_session s JOIN hub_login_principal p ON p.issuer=s.issuer AND p.subject=s.subject
 WHERE s.token_hash=? AND s.issuer=? AND s.subject=? AND p.disabled_at IS NULL AND s.expires_at>?
 AND s.authenticated_at>? AND s.authenticated_at<=? AND NOT EXISTS (SELECT 1 FROM json_each(?) x
 WHERE NOT EXISTS (SELECT 1 FROM hub_login_permission g WHERE g.issuer=s.issuer AND g.subject=s.subject AND g.permission=x.value)) RETURNING id`,
        )
        .bind(
          id,
          approved.request.clientId,
          resource,
          JSON.stringify(selected),
          now,
          expiry,
          session.token_hash,
          session.issuer,
          session.subject,
          now,
          now - age,
          now + 5000,
          JSON.stringify(selected),
        )
        .first();
      if (!inserted) throw new Fault("invalid_grant");
      const result = await api.completeAuthorization({
        request: approved.request,
        userId: await digest(session.issuer + "\0" + session.subject),
        metadata: {},
        scope: selected,
        props: { bridgeId: id },
        revokeExistingGrants: false,
      });
      approved.headers.set("Location", result.redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    // Bound library form/JSON parsers before dispatch, including requests lacking Content-Length.
    if (req.method === "POST") {
      const bytes = await boundedBody(req, 16384);
      req = new Request(req, { body: bytes as Uint8Array<ArrayBuffer> });
      if (path === "/oauth/token") {
        const form = new URLSearchParams(new TextDecoder().decode(bytes));
        if (
          form.get("grant_type") === "authorization_code" &&
          (form.getAll("code_verifier").length !== 1 ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(form.get("code_verifier") || ""))
        )
          throw new Fault("invalid_request");
        if (!form.has("grant_type") && form.get("token")) {
          if (
            form.getAll("token").length !== 1 ||
            form.getAll("client_id").length > 1
          )
            throw new Fault("invalid_request");
          const token = await db
            .prepare(
              "SELECT grant_id,client_id FROM hub_oauth_token WHERE token_hash=?",
            )
            .bind(await hashLoginToken(form.get("token")!))
            .first<{ grant_id: string; client_id: string }>();
          let claimedClient = form.get("client_id");
          // Extract only a routing identity. The library below exclusively authenticates it.
          const authorization = req.headers.get("Authorization");
          if (authorization) {
            if (claimedClient || !/^Basic /i.test(authorization))
              throw new Fault("invalid_request");
            try {
              const raw = atob(authorization.slice(6));
              const split = raw.indexOf(":");
              if (split < 0) throw Error();
              claimedClient = decodeURIComponent(
                raw.slice(0, split).replace(/\+/g, " "),
              );
            } catch {
              throw new Fault("invalid_client", 401);
            }
          } else if (!claimedClient && token) {
            // Bind an assertion-only request to the token owner, then let the library verify
            // assertion issuer, subject, audience, signature and replay protections.
            claimedClient = token.client_id;
            form.set("client_id", claimedClient);
            req = new Request(req, { body: form });
          }
          const response = await server.fetch(req, env, ctx);
          if (
            response.ok &&
            token &&
            claimedClient === token.client_id &&
            typeof token.grant_id === "string"
          ) {
            await db
              .prepare(
                "UPDATE hub_oauth_grant SET revoked_at=? WHERE id=? AND client_id=? AND issuer=? AND resource=?",
              )
              .bind(
                Date.now(),
                token.grant_id,
                token.client_id,
                profile.issuer,
                resource,
              )
              .run();
          }
          const h = new Headers(response.headers);
          Object.entries(safeHeaders).forEach(([k, v]) => h.set(k, v));
          return new Response(response.body, {
            status: response.status,
            headers: h,
          });
        }
      }
    }
    const response = await server.fetch(req, env, ctx);
    if (path === "/oauth/token" && req.method === "POST" && response.ok) {
      const body = (await response.clone().json()) as { access_token?: string };
      if (typeof body.access_token !== "string" || !issuing)
        throw new Fault("temporarily_unavailable", 503);
      const now = Date.now();
      const saved = await db
        .prepare(
          `INSERT INTO hub_oauth_token(token_hash,grant_id,client_id)
        SELECT ?,id,client_id FROM hub_oauth_grant WHERE id=? AND client_id=? AND issuer=? AND resource=? AND exchanged=1 AND revoked_at IS NULL AND expires_at>? AND ${current} RETURNING token_hash`,
        )
        .bind(
          await hashLoginToken(body.access_token),
          issuing.id,
          issuing.clientId,
          profile.issuer,
          resource,
          now,
          now,
          now - age,
          now + 5000,
        )
        .first();
      if (!saved) throw new Fault("temporarily_unavailable", 503);
    }
    return response;
  } catch (error) {
    if (error instanceof AuthorizationError)
      return error.redirectTo
        ? new Response(null, {
            status: 302,
            headers: { ...safeHeaders, Location: error.redirectTo },
          })
        : json({ error: error.code }, 400);
    if (error instanceof Fault)
      return json({ error: error.code }, error.status);
    return json({ error: "temporarily_unavailable" }, 503);
  }
}

/** Bounded cleanup is safe when disabled too; it never creates credentials. */
export async function cleanupOAuth(env: OAuthEnv) {
  if (!env.LOGIN_DB) return;
  const db = env.LOGIN_DB.withSession("first-primary"),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        "DELETE FROM hub_oauth_consent WHERE handle_hash IN (SELECT handle_hash FROM hub_oauth_consent WHERE expires_at<=? LIMIT 500)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM hub_oauth_grant WHERE id IN (SELECT id FROM hub_oauth_grant WHERE expires_at<=? LIMIT 500)",
      )
      .bind(now),
  ]);
}
