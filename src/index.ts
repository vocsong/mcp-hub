import { handleOAuth, cleanupOAuth, oauthEnabled } from "./oauth";
import { handleLogin, cleanupLogin } from "./login/worker";
import {
  handleClientManagement,
  cleanupClients,
  capabilityAuthEnabled,
} from "./authorization";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z, ZodError } from "zod";
import { identity, boundedBody } from "./security";
import { Tenant, speechSchema } from "./tenant";
import { dashboard, css, script } from "./dashboard";
import { Fault, MODEL, type Env, type Identity } from "./types";
export { Tenant };
const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const knownErrors: Record<string, number> = {
  request_in_progress: 409,
  idempotency_conflict: 409,
  approval_content_mismatch: 409,
  approval_expired: 410,
  not_pending: 409,
  not_found: 404,
  audio_expired_or_not_found: 404,
  daily_budget_exceeded: 429,
  provider_key_required: 409,
  request_capacity_reached: 429,
  real_keys_forbidden_in_demo: 400,
  trial_policy_required: 400,
  trial_text_too_long: 400,
  trial_budget_exhausted: 429,
  live_provider_disabled: 503,
  key_update_cancelled: 409,
  price_review_required: 503,
};
const rpcFault = (e: unknown) =>
  e instanceof Error && knownErrors[e.message]
    ? new Fault(e.message, knownErrors[e.message])
    : e;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: responseHeaders });
async function handleAuthenticated(
  req: Request,
  env: Env,
  who: Identity,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const tenant = env.TENANTS.getByName(who.tenant);
  await tenant.bindTenant(who.tenant);
  if (path === "/openrouter") {
    const requireScope = (scope: string) => {
      if (!who.scopes.includes(scope))
        throw new Fault("insufficient_scope", 403);
    };
    if (req.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    const body = await boundedBody(req);
    const mcp = new McpServer({
      name: "vocs-openrouter",
      version: "0.1.0",
    });
    mcp.registerTool(
      "openrouter_models",
      {
        description:
          "List reviewed capabilities. This preview only permits a bounded TTS preset, not arbitrary proxy requests.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        requireScope("models:read");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                models: [
                  {
                    id: MODEL,
                    voices: ["en_paul_neutral"],
                    maxInputBytes: env.APP_MODE === "production" ? 300 : 2000,
                  },
                ],
                demo: env.LIVE_PROVIDER !== "enabled",
              }),
            },
          ],
        };
      },
    );
    mcp.registerTool(
      "openrouter_speech",
      {
        description:
          "Prepare or execute speech with a UUID idempotency key. If pending, a human must approve in the dashboard then resend identical arguments. Never retry an uncertain outcome with a new ID. Local mode returns a tone. The $0.10 reservation is not a guaranteed upstream billing cap.",
        inputSchema: speechSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args) => {
        requireScope("speech:write");
        try {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(await tenant.speech(who.tenant, args)),
              },
            ],
          };
        } catch (e) {
          e = rpcFault(e);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: e instanceof Fault ? e.code : "request_failed",
              },
            ],
          };
        }
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcp.connect(transport);
    try {
      const result = await transport.handleRequest(
        new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: new TextDecoder().decode(body),
        }),
      );
      const response = new Response(result.body, result);
      for (const [k, v] of Object.entries(responseHeaders))
        response.headers.set(k, v);
      return response;
    } finally {
      await mcp.close();
    }
  }
  const audioPrefix = path.startsWith("/openrouter/audio/")
    ? "/openrouter/audio/"
    : "/audio/";
  if (path.startsWith(audioPrefix)) {
    if (!who.scopes.includes("audio:read") && !who.dashboard)
      throw new Fault("insufficient_scope", 403);
    if (req.method !== "GET") throw new Fault("method_not_allowed", 405);
    const result = await tenant.audio(
      who.tenant,
      z.string().uuid().parse(path.slice(audioPrefix.length)),
    );
    for (const [k, v] of Object.entries(responseHeaders))
      result.headers.set(k, v);
    return result;
  }
  if (!who.dashboard) throw new Fault("dashboard_scope_required", 403);
  if (
    req.method === "GET" &&
    ["/", "/dashboard", "/app.css", "/app.js"].includes(path)
  )
    return new Response(
      path === "/app.css" ? css : path === "/app.js" ? script : dashboard,
      {
        headers: {
          ...responseHeaders,
          "Content-Type":
            path === "/app.css"
              ? "text/css"
              : path === "/app.js"
                ? "text/javascript"
                : "text/html; charset=utf-8",
        },
      },
    );
  if (path === "/api/status" && req.method === "GET")
    return json({
      ...(await tenant.status()),
      clientAccess: capabilityAuthEnabled(env) && env.OAUTH_ENABLED !== "true",
      oauthAccess: capabilityAuthEnabled(env) && env.OAUTH_ENABLED === "true",
      oauthResource:
        env.OAUTH_ENABLED === "true"
          ? env.PUBLIC_ORIGIN + "/openrouter"
          : undefined,
    });
  if (path.startsWith("/api/")) {
    if (
      env.APP_MODE === "production" &&
      req.headers.get("Origin") !== env.PUBLIC_ORIGIN
    )
      throw new Fault("invalid_origin", 403);
    if (
      req.method === "POST" &&
      req.headers.get("Content-Type")?.split(";")[0].trim() !==
        "application/json"
    )
      throw new Fault("invalid_request", 400);
    if (
      ["/api/speech", "/api/approve"].includes(path) &&
      !who.scopes.includes("speech:write")
    )
      throw new Fault("insufficient_scope", 403);
    if (req.headers.get("X-Vocs-Intent") !== "dashboard")
      throw new Fault("intent_header_required", 403);
    const value =
      req.method === "POST"
        ? JSON.parse(new TextDecoder().decode(await boundedBody(req)))
        : undefined;
    if (path === "/api/key" && req.method === "POST")
      return json(await tenant.connectKey(who.tenant, value));
    if (path === "/api/key" && req.method === "DELETE")
      return json(await tenant.disconnectKey());
    if (path === "/api/policy" && req.method === "POST")
      return json(await tenant.configurePolicy(value));
    if (path === "/api/speech" && req.method === "POST")
      return json(await tenant.speech(who.tenant, value));
    if (path === "/api/approve" && req.method === "POST")
      return json(
        await tenant.approve(speechSchema.parse(value).requestId, value),
      );
    if (path.startsWith("/api/audio/") && req.method === "DELETE")
      return json(
        await tenant.deleteAudio(
          who.tenant,
          z.string().uuid().parse(path.slice(11)),
        ),
      );
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    try {
      const login = await handleLogin(req, env);
      if (login) return login;
      if (env.OAUTH_ENABLED === "true") {
        if (!ctx) throw new Fault("oauth_context_required", 503);
        const oauth = await handleOAuth(req, env, ctx, (who) =>
          handleAuthenticated(req, env, who),
        );
        if (oauth) return oauth;
      }
      if (
        oauthEnabled(env) &&
        req.method === "POST" &&
        new URL(req.url).pathname === "/api/clients"
      )
        throw new Fault("oauth_connection_required", 403);
      const client = await handleClientManagement(req, env);
      if (client) return client;
      const who = await identity(req, env);
      return await handleAuthenticated(req, env, who);
    } catch (e) {
      e = rpcFault(e);
      return json(
        {
          error:
            e instanceof Fault
              ? e.code
              : e instanceof ZodError || e instanceof SyntaxError
                ? "invalid_request"
                : "request_failed",
        },
        e instanceof Fault
          ? e.status
          : e instanceof ZodError || e instanceof SyntaxError
            ? 400
            : 500,
      );
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await cleanupLogin(env);
    if (capabilityAuthEnabled(env)) await cleanupClients(env);
    if (oauthEnabled(env)) await cleanupOAuth(env);
  },
} satisfies ExportedHandler<Env>;
