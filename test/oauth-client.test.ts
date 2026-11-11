/** Real MCP SDK OAuth + transport interoperability, entirely in local Workers bindings.
 * This does not certify Dots or VocsCode UI support, or contact OpenRouter.
 */
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auth,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import worker from "../src/index";
import { hashLoginToken, VOCS_ISSUER } from "../src/login/worker";
import { MODEL, type Env } from "../src/types";
import loginSchema from "../migrations/login/0001_product_sessions.sql?raw";
import capabilitySchema from "../migrations/login/0002_capability_clients.sql?raw";
import oauthSchema from "../migrations/login/0003_oauth_grants.sql?raw";

const origin = "https://mcp.vocs.io";
const resource = origin + "/openrouter";
const bindings = env as unknown as Env;
const db = bindings.LOGIN_DB!;
const config: Env = {
  ...bindings,
  PUBLIC_ORIGIN: origin,
  APP_MODE: "production",
  LIVE_PROVIDER: "disabled",
  PRODUCT_LOGIN_ENABLED: "true",
  CAPABILITY_AUTH_ENABLED: "true",
  OAUTH_ENABLED: "true",
  OAUTH_DCR_ENABLED: "true",
};
const browserToken = "s".repeat(43);
const browserCookie = "__Host-mcp.session=" + browserToken;

class MemoryOAuthClient implements OAuthClientProvider {
  readonly redirectUrl = "http://localhost:49152/callback";
  readonly clientMetadata = {
    client_name: "Local SDK interoperability test",
    redirect_uris: [this.redirectUrl],
    token_endpoint_auth_method: "none" as const,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "models:read",
  };
  information?: OAuthClientInformationMixed;
  storedTokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
  authorizationUrl?: URL;
  verifier = "";
  readonly expectedState = crypto.randomUUID();
  state() {
    return this.expectedState;
  }
  clientInformation() {
    return this.information;
  }
  saveClientInformation(value: OAuthClientInformationMixed) {
    this.information = value;
  }
  tokens() {
    return this.storedTokens;
  }
  saveTokens(value: OAuthTokens) {
    this.storedTokens = value;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(value: string) {
    this.verifier = value;
  }
  codeVerifier() {
    return this.verifier;
  }
  saveDiscoveryState(value: OAuthDiscoveryState) {
    this.discovery = value;
  }
  discoveryState() {
    return this.discovery;
  }
}

beforeAll(async () => {
  for (const schema of [loginSchema, capabilitySchema, oauthSchema]) {
    for (const sql of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.prepare(sql).run();
    }
  }
});
beforeEach(async () => {
  for (const table of [
    "hub_oauth_consent",
    "hub_oauth_grant",
    "hub_oauth_rate",
    "hub_client_token",
    "hub_login_permission",
    "hub_login_session",
    "hub_login_principal",
  ]) {
    await db.prepare("DELETE FROM " + table).run();
  }
  await db
    .prepare("INSERT INTO hub_login_principal VALUES (?,?,NULL)")
    .bind(VOCS_ISSUER, "sdk-alice")
    .run();
  await db
    .prepare("INSERT INTO hub_login_session VALUES (?,?,?,?,?,?)")
    .bind(
      await hashLoginToken(browserToken),
      "sdk-browser",
      VOCS_ISSUER,
      "sdk-alice",
      Date.now(),
      Date.now() + 1800000,
    )
    .run();
  for (const scope of ["models:read", "speech:write", "audio:read"]) {
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?,?,?)")
      .bind(VOCS_ISSUER, "sdk-alice", scope)
      .run();
  }
});

describe("MCP SDK OAuth client interoperability", () => {
  it("discovers, registers, authorizes with PKCE, exchanges, calls MCP and loses access on revocation", async () => {
    const trace: { path: string; method: string; body?: string }[] = [];
    const localFetch: FetchLike = async (input, init) => {
      const request = new Request(
        input instanceof URL ? input.href : input,
        init,
      );
      // No network fallback: fail if any SDK action leaves our local Worker origin.
      expect(new URL(request.url).origin).toBe(origin);
      trace.push({
        path: new URL(request.url).pathname,
        method: request.method,
        body:
          request.method === "POST" ? await request.clone().text() : undefined,
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, config, ctx);
      await waitOnExecutionContext(ctx);
      return response;
    };
    const legacyIssuance = await localFetch(origin + "/api/clients", {
      method: "POST",
      headers: {
        cookie: browserCookie,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Vocs-Intent": "dashboard",
      },
      body: JSON.stringify({
        client: "dots",
        scopes: ["models:read"],
        consent: true,
      }),
    });
    expect(legacyIssuance.status).toBe(403);
    expect(await legacyIssuance.json()).toMatchObject({
      error: "oauth_connection_required",
    });
    const challenge = await localFetch(resource);
    expect(challenge.status).toBe(401);
    const parameters = extractWWWAuthenticateParams(challenge);
    expect(parameters.resourceMetadataUrl?.href).toBe(
      origin + "/.well-known/oauth-protected-resource/openrouter",
    );
    const provider = new MemoryOAuthClient();
    expect(
      await auth(provider, {
        serverUrl: resource,
        resourceMetadataUrl: parameters.resourceMetadataUrl,
        fetchFn: localFetch,
      }),
    ).toBe("REDIRECT");
    expect(
      trace.some(
        (r) => r.path === "/.well-known/oauth-protected-resource/openrouter",
      ),
    ).toBe(true);
    expect(
      trace.some((r) => r.path === "/.well-known/oauth-authorization-server"),
    ).toBe(true);
    expect(provider.discovery?.resourceMetadata?.resource).toBe(resource);
    const registration = JSON.parse(
      trace.find((r) => r.path === "/oauth/register")!.body!,
    );
    expect(registration.token_endpoint_auth_method).toBe("none");
    expect(provider.information?.client_id).toBeTruthy();
    expect(provider.information?.client_secret).toBeUndefined();
    const authorize = provider.authorizationUrl!;
    expect(authorize.searchParams.get("resource")).toBe(resource);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(provider.verifier.length).toBeGreaterThanOrEqual(43);
    expect(authorize.searchParams.get("code_challenge")).not.toBe(
      provider.verifier,
    );
    const consent = await localFetch(authorize, {
      headers: { cookie: browserCookie },
    });
    expect(consent.status).toBe(200);
    const html = await consent.text();
    const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
    expect(handle).toBeTruthy();
    const bindingCookie = consent.headers.get("Set-Cookie")!.split(";")[0];
    const approved = await localFetch(origin + "/oauth/authorize", {
      method: "POST",
      headers: {
        cookie: browserCookie + "; " + bindingCookie,
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        handle: handle!,
        decision: "approve",
        scope: "models:read",
      }),
    });
    expect(approved.status).toBe(302);
    const callback = new URL(approved.headers.get("Location")!);
    // SDK auth accepts a code, not a callback URL. The embedding client must
    // validate callback state/issuer before passing that code to the SDK.
    expect(callback.origin + callback.pathname).toBe(provider.redirectUrl);
    expect(callback.searchParams.get("state")).toBe(provider.expectedState);
    expect(callback.searchParams.get("iss")).toBe(origin);
    expect(callback.searchParams.get("code")).toBeTruthy();
    expect(
      await auth(provider, {
        serverUrl: resource,
        authorizationCode: callback.searchParams.get("code")!,
        fetchFn: localFetch,
      }),
    ).toBe("AUTHORIZED");
    expect(provider.storedTokens?.access_token).toBeTruthy();
    expect(provider.storedTokens?.scope).toBe("models:read");
    expect(provider.storedTokens?.refresh_token).toBeUndefined();
    expect(provider.storedTokens?.expires_in).toBeLessThanOrEqual(300);
    const exchange = new URLSearchParams(
      trace.find((r) => r.path === "/oauth/token")!.body,
    );
    expect(exchange.get("code_verifier")).toBe(provider.verifier);
    expect(exchange.get("resource")).toBe(resource);
    expect(exchange.has("client_secret")).toBe(false);

    const client = new Client({ name: "local-sdk-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      authProvider: provider,
      fetch: localFetch,
    });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe("vocs-openrouter");
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toContain("openrouter_models");
      const models = await client.callTool({
        name: "openrouter_models",
        arguments: {},
      });
      expect(models.isError).not.toBe(true);
      expect(JSON.stringify(models.content)).toContain(MODEL);
      const bearer = {
        Authorization: "Bearer " + provider.storedTokens!.access_token,
      };
      // Direct request preserves the HTTP scope challenge rather than triggering
      // the SDK transport's automatic step-up redirect on an expected 403.
      const denied = await localFetch(resource, {
        method: "POST",
        headers: {
          ...bearer,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 50,
          method: "tools/call",
          params: {
            name: "openrouter_speech",
            arguments: {
              text: "Never sent upstream",
              voice: "en_paul_neutral",
              requestId: crypto.randomUUID(),
            },
          },
        }),
      });
      expect(denied.status).toBe(403);
      expect(extractWWWAuthenticateParams(denied).scope).toContain(
        "speech:write",
      );
      for (const path of ["/api/state", "/api/key", "/api/oauth/grants"]) {
        const isolated = await localFetch(origin + path, { headers: bearer });
        expect(isolated.status).toBe(path === "/api/oauth/grants" ? 401 : 403);
        expect(await isolated.json()).toMatchObject({
          error:
            path === "/api/oauth/grants"
              ? "invalid_identity"
              : "insufficient_scope",
        });
      }
      const grants = await localFetch(origin + "/api/oauth/grants", {
        headers: { cookie: browserCookie },
      });
      expect(grants.status).toBe(200);
      const { grants: rows } = (await grants.json()) as {
        grants: { id: string }[];
      };
      expect(rows).toHaveLength(1);
      const revoked = await localFetch(
        origin + "/api/oauth/grants/" + rows[0].id,
        {
          method: "DELETE",
          headers: { cookie: browserCookie, Origin: origin },
        },
      );
      expect(revoked.status).toBe(200);
      expect((await localFetch(resource, { headers: bearer })).status).toBe(
        401,
      );
    } finally {
      await client.close();
    }
  });
});
