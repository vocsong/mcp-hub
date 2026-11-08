import { admitted, createAuth, type AuthEnv } from "./config";

const securityHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "strict-transport-security": "max-age=31536000",
};
const reply = (status: number, error: string) =>
  Response.json({ error }, { status });
async function route(request: Request, env: AuthEnv): Promise<Response> {
  if (env.AUTH_ENABLED !== "true") return reply(503, "Login is not enabled");
  const auth = createAuth(env);
  if (request.url.length > 8192) return reply(414, "URL too long");
  const url = new URL(request.url);
  if (url.origin !== env.AUTH_ORIGIN) return reply(400, "Invalid origin");
  if (url.pathname === "/openrouter" || url.pathname.startsWith("/mcp"))
    return reply(401, "A separate MCP client authorization is required");
  if (url.pathname === "/login-error")
    return reply(403, "Sign-in could not be completed");
  if (url.pathname === "/account" && request.method === "GET") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return reply(401, "Sign in required");
    if (
      !session.user.emailVerified ||
      !(await admitted(env.AUTH_DB!, session.user.email))
    )
      return reply(403, "Access revoked");
    return Response.json({
      user: { id: session.user.id, email: session.user.email },
      expiresAt: session.session.expiresAt,
      mcpAuthorized: false,
    });
  }
  const callback = /^\/api\/auth\/callback\/(google|github)$/.test(
    url.pathname,
  );
  const post = [
    "/api/auth/sign-in/social",
    "/api/auth/sign-out",
    "/api/auth/revoke-sessions",
  ];
  if (callback && request.method === "GET") return auth.handler(request);
  if (!post.includes(url.pathname) || request.method !== "POST")
    return reply(404, "Not found");
  // Require explicit same-origin JSON even on unauthenticated login initiation.
  if (
    request.headers.get("origin") !== env.AUTH_ORIGIN ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return reply(403, "Invalid origin");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reply(415, "JSON required");
  const reader = request.body?.getReader();
  let raw = "",
    size = 0;
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return reply(413, "Request too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return reply(400, "Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return reply(400, "Invalid JSON");
  if (url.pathname === "/api/auth/sign-in/social") {
    if (
      Object.keys(body).some((k) => k !== "provider") ||
      !["google", "github"].includes(String(body.provider))
    )
      return reply(400, "Only a configured social provider is accepted");
    body = {
      provider: body.provider,
      callbackURL: `${env.AUTH_ORIGIN}/account`,
      errorCallbackURL: `${env.AUTH_ORIGIN}/login-error`,
      disableRedirect: true,
    };
  } else {
    if (Object.keys(body).length) return reply(400, "Unexpected fields");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return reply(401, "Sign in required");
    // Await the authoritative deletion ourselves: the library's logout is best-effort.
    await env
      .AUTH_DB!.prepare(
        url.pathname.endsWith("/revoke-sessions")
          ? "DELETE FROM session WHERE userId = ?"
          : "DELETE FROM session WHERE id = ?",
      )
      .bind(
        url.pathname.endsWith("/revoke-sessions")
          ? session.user.id
          : session.session.id,
      )
      .run();
    return auth.handler(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: request.headers,
        body: "{}",
      }),
    );
  }
  return auth.handler(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    }),
  );
}
export default {
  async scheduled(_event: ScheduledController, env: AuthEnv): Promise<void> {
    if (env.AUTH_ENABLED !== "true" || !env.AUTH_DB) return;
    const now = Date.now();
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare(
        "DELETE FROM hub_rate_limit WHERE expires_at < ?",
      ).bind(now),
      env.AUTH_DB.prepare("DELETE FROM verification WHERE expiresAt < ?").bind(
        new Date(now).toISOString(),
      ),
      env.AUTH_DB.prepare("DELETE FROM session WHERE expiresAt < ?").bind(
        new Date(now).toISOString(),
      ),
    ]);
  },
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch {
      response = reply(503, "Login is temporarily unavailable");
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(securityHeaders))
      headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
