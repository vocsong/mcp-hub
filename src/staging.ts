/** Isolated, models-only staging. No Tenant/DO, R2, provider execution, dashboard
 * mutations or provider/encryption secrets are needed or accepted by this entry.
 * Login/OAuth storage writes are limited to their protocol lifecycle.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handleLogin, cleanupLogin } from "./login/worker";
import { selectLoginProfile, STAGING_LOGIN } from "./login/profile";
import { handleOAuth, cleanupOAuth, type OAuthEnv } from "./oauth";
import type { NativeCatalogEnv } from "./native-catalog";
import { handleAccountCatalog } from "./authorization";
import { boundedBody } from "./security";
import { Fault, MODEL, type Identity } from "./types";
export interface StagingEnv extends OAuthEnv, NativeCatalogEnv {
  STAGING_ENABLED?: string;
  LIVE_PROVIDER?: string;
}
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=86400",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
const secureResponse = (response: Response) => {
  const result = new Response(response.body, response);
  result.headers.set("Strict-Transport-Security", "max-age=86400");
  return result;
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
function ready(env: StagingEnv): boolean {
  // An accidental environment copy fails closed rather than making secrets or
  // storage usable. Provision only a new staging LOGIN_DB and OAUTH_KV later.
  return (
    selectLoginProfile(env) === STAGING_LOGIN &&
    env.STAGING_ENABLED === "true" &&
    env.APP_MODE === "production" &&
    env.PRODUCT_LOGIN_ENABLED === "true" &&
    env.CAPABILITY_AUTH_ENABLED === "true" &&
    env.OAUTH_ENABLED === "true" &&
    env.LIVE_PROVIDER === "disabled" &&
    !!env.LOGIN_DB &&
    !!env.OAUTH_KV &&
    ![
      "AUDIO",
      "TENANTS",
      "KEY_ENCRYPTION_KEY",
      "OPENROUTER_API_KEY",
      "AUTH_ISSUER",
      "AUTH_JWKS_URL",
    ].some((key) => key in env)
  );
}
async function models(request: Request, who: Identity): Promise<Response> {
  if (
    !who.scopes.includes("models:read") ||
    who.scopes.some((s) => s !== "models:read")
  )
    throw new Fault("insufficient_scope", 403);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  const body = await boundedBody(request);
  const mcp = new McpServer({
    name: "vocs-openrouter-staging",
    version: "0.1.0",
  });
  mcp.registerTool(
    "openrouter_models",
    {
      description:
        "List the reviewed model catalog. This isolated staging service cannot execute speech, paid requests or audio operations.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            models: [{ id: MODEL }],
            mode: "models-only",
            executionEnabled: false,
            liveProvider: false,
          }),
        },
      ],
    }),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  try {
    const result = await transport.handleRequest(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: new TextDecoder().decode(body),
      }),
    );
    const response = new Response(result.body, result);
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  } finally {
    await mcp.close();
  }
}
export default {
  async fetch(
    request: Request,
    env: StagingEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      if (new URL(request.url).origin !== STAGING_LOGIN.origin)
        return json({ error: "invalid_host" }, 403);
      const path = new URL(request.url).pathname;
      const enabled = ready(env);
      if (path === "/health" && request.method === "GET")
        return json({
          mode: enabled ? "models-only" : "disabled",
          liveProvider: false,
          audio: false,
        });
      if (!enabled) return json({ error: "staging_not_enabled" }, 503);
      const catalog = await handleAccountCatalog(request, env);
      if (catalog) return secureResponse(catalog);
      // Explicit route allowlist: there is no fallback to dashboard/manual tokens,
      // tenant operations, a production identity provider, or arbitrary proxies.
      if (path.startsWith("/login") || path === "/account") {
        const login = await handleLogin(request, env);
        if (login) return secureResponse(login);
      }
      if (path === "/" && request.method === "GET")
        return new Response(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>MCP Hub staging</title><h1>Models-only staging</h1><p>Isolated OAuth interoperability testing. No provider keys, paid requests, audio or dashboard mutations.</p><p><a href="/login">Sign in to staging</a></p>',
          {
            headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
          },
        );
      if (
        path === "/openrouter" ||
        path.startsWith("/.well-known/oauth-") ||
        [
          "/oauth/authorize",
          "/oauth/token",
          "/oauth/register",
          "/api/oauth/grants",
        ].includes(path) ||
        /^\/api\/oauth\/grants\/[a-f0-9-]{36}$/.test(path)
      ) {
        const oauth = await handleOAuth(request, env, ctx, (who) =>
          models(request, who),
        );
        if (oauth) return secureResponse(oauth);
      }
      return json({ error: "staging_read_only" }, 403);
    } catch (error) {
      return error instanceof Fault
        ? json({ error: error.code }, error.status)
        : json({ error: "request_failed" }, 400);
    }
  },
  async scheduled(_event: ScheduledController, env: StagingEnv): Promise<void> {
    if (!ready(env)) return;
    await cleanupLogin(env);
    await cleanupOAuth(env);
  },
} satisfies ExportedHandler<StagingEnv>;
