import { env } from "cloudflare:test";
import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import preview, { type PreviewEnv } from "../src/preview-login";
import mock from "../src/preview";
import loginSchema from "../migrations/login/0001_product_sessions.sql?raw";
/** The production preview entry (wrangler.preview.live.jsonc) with and without
 * NATIVE_CATALOG_ENABLED. The flag-off case must stay the identity-only mock. */
const origin = "https://mcp.vocs.io";
const issuer = "https://auth.vocs.io/api/auth";
const resource = origin + "/api/connections";
const metadataUrl =
  origin + "/.well-known/oauth-protected-resource/api/connections";
const db = (env as unknown as { LOGIN_DB: D1Database }).LOGIN_DB;
// Exactly the live vars before this change, plus the test D1 binding.
const live: PreviewEnv = {
  PRODUCT_LOGIN_ENABLED: "true",
  PUBLIC_ORIGIN: origin,
  LOGIN_DB: db,
};
// The live vars after this change, plus the post-deploy secret.
const enabled: PreviewEnv = {
  ...live,
  APP_MODE: "production",
  CAPABILITY_AUTH_ENABLED: "true",
  NATIVE_CATALOG_ENABLED: "true",
  NATIVE_CATALOG_CLIENT_SECRET: "synthetic-service-secret",
};
const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });
async function snapshot(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers],
    body: await response.text(),
  };
}
beforeAll(async () => {
  for (const sql of loginSchema.split(";").filter((s) => s.trim()))
    await db.prepare(sql).run();
});
afterEach(() => vi.restoreAllMocks());
describe("production preview native catalog", () => {
  it("without the flag both catalog paths stay the byte-identical mock 404", async () => {
    for (const settings of [
      live,
      // The capability vars alone must not route anything either.
      { ...enabled, NATIVE_CATALOG_ENABLED: undefined },
    ])
      for (const url of [resource, metadataUrl]) {
        const response = await preview.fetch(get(url), settings);
        expect(response.status).toBe(404);
        // The production host adds only HSTS; everything else is the mock's.
        expect(response.headers.get("Strict-Transport-Security")).toBe(
          "max-age=31536000",
        );
        response.headers.delete("Strict-Transport-Security");
        expect(await snapshot(response)).toEqual(
          await snapshot(mock.fetch(get(url))),
        );
      }
  });
  it("with the flag serves the exact production protected-resource metadata", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const response = await preview.fetch(get(metadataUrl), enabled);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["catalog:read"],
      bearer_methods_supported: ["header"],
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
    // Secret not yet provisioned: fails closed instead of advertising.
    expect(
      (
        await preview.fetch(get(metadataUrl), {
          ...enabled,
          NATIVE_CATALOG_CLIENT_SECRET: undefined,
        })
      ).status,
    ).toBe(503);
    expect(network).not.toHaveBeenCalled();
  });
  it("with the flag rejects anonymous, malformed-bearer and foreign-origin catalog reads", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    for (const headers of [{}, { Authorization: "Bearer invalid" }]) {
      const response = await preview.fetch(get(resource, headers), enabled);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        `Bearer realm="vocs-catalog", error="invalid_token", resource_metadata="${metadataUrl}"`,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Strict-Transport-Security")).toBe(
        "max-age=31536000",
      );
    }
    const foreign = await preview.fetch(
      get(resource, { Origin: "https://example.invalid" }),
      enabled,
    );
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "invalid_origin" });
    for (const url of [resource + "?user=bob", metadataUrl + "?x=1"])
      expect((await preview.fetch(get(url), enabled)).status).toBe(400);
    expect(
      (await preview.fetch(new Request(resource, { method: "POST" }), enabled))
        .status,
    ).toBe(405);
    expect(network).not.toHaveBeenCalled();
  });
  it("sends one-year HSTS from every production route, with or without the flag", async () => {
    for (const settings of [live, enabled])
      for (const path of ["/", "/dashboard", "/app.js", "/health", "/login", "/login/session", "/api/connections"]) {
        const response = await preview.fetch(get(origin + path), settings);
        expect(
          response.headers.get("Strict-Transport-Security"),
          `${path} (${settings === live ? "flag off" : "flag on"})`,
        ).toBe("max-age=31536000");
      }
  });
  it("with the flag leaves every other preview route exactly as the mock", async () => {
    for (const path of [
      "/",
      "/dashboard",
      "/app.css",
      "/app.js",
      "/openrouter",
      "/api/key",
      "/api/keys",
      "/api/status",
      "/api/clients",
      "/api/oauth/grants",
      "/api/audio",
      "/speech",
      "/oauth/authorize",
      "/oauth/token",
      "/oauth/register",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/openrouter",
    ]) {
      for (const method of ["GET", "POST"]) {
        const request = () =>
          new Request(origin + path, {
            method,
            body: method === "POST" ? "{}" : undefined,
          });
        expect(
          await snapshot(await preview.fetch(request(), enabled)),
          `${method} ${path}`,
        ).toEqual(await snapshot(await preview.fetch(request(), live)));
      }
    }
    const health = await (
      await preview.fetch(get(origin + "/health"), enabled)
    ).json();
    expect(health).toEqual(
      await (await preview.fetch(get(origin + "/health"), live)).json(),
    );
    expect(health).toMatchObject({
      mode: "browser-only-mock",
      liveProvider: false,
      serverStorage: true,
      productLogin: "identity-only",
      mcpAuthorized: false,
    });
    expect(
      await (
        await preview.fetch(get(origin + "/login/session"), enabled)
      ).json(),
    ).toEqual({ error: "sign_in_required" });
  });
  it("with the flag admits a verified Vocs Code bearer for a granted account, OAuth still unavailable", async () => {
    const pair = await generateKeyPair("ES256");
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "fixture",
      alg: "ES256",
      use: "sig",
    };
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: "preview-alice",
      aud: resource,
      iat: now,
      exp: now + 300,
      sid: "source-session",
      azp: "vocs-code",
      scope: "catalog:read",
    };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "fixture", typ: "at+jwt" })
      .sign(pair.privateKey);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      if (String(input) === issuer + "/jwks")
        return Response.json({ keys: [jwk] });
      expect(String(input)).toBe(issuer + "/oauth2/introspect");
      const body = new URLSearchParams(String(options?.body));
      expect(body.get("client_id")).toBe("mcp-hub-catalog");
      expect(body.get("client_secret")).toBe("synthetic-service-secret");
      return Response.json({
        ...claims,
        client_id: "vocs-code",
        token_type: "Bearer",
        active: true,
      });
    });
    const request = () => get(resource, { Authorization: "Bearer " + token });
    // A verified token alone grants nothing: the Hub principal needs dashboard:manage.
    expect((await preview.fetch(request(), enabled)).status).toBe(403);
    await db
      .prepare("INSERT INTO hub_login_principal VALUES (?, ?, NULL)")
      .bind("https://auth.vocs.io", "preview-alice")
      .run();
    for (const grant of ["dashboard:manage", "models:read"])
      await db
        .prepare("INSERT INTO hub_login_permission VALUES (?, ?, ?)")
        .bind("https://auth.vocs.io", "preview-alice", grant)
        .run();
    const response = await preview.fetch(request(), enabled);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      account: { identityIssuer: string };
      connections: Record<string, unknown>[];
    };
    expect(body.account.identityIssuer).toBe("https://auth.vocs.io");
    expect(body.connections).toEqual([
      {
        id: "openrouter",
        name: "OpenRouter",
        transport: "streamable-http",
        resource: origin + "/openrouter",
        authorizationServer: null,
        accountScopes: ["models:read"],
        authorization: "unavailable",
        executionReadiness: "not_checked",
      },
    ]);
  });
  it("with the flag admits the persistent desktop client only when introspection names the same client", async () => {
    const pair = await generateKeyPair("ES256");
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "fixture",
      alg: "ES256",
      use: "sig",
    };
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: "preview-device-alice",
      aud: resource,
      iat: now,
      exp: now + 300,
      sid: "device-grant-id",
      azp: "vocs-code-device",
      client_id: "vocs-code-device",
      scope: "catalog:read",
    };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "fixture", typ: "at+jwt" })
      .sign(pair.privateKey);
    let introspected: Record<string, unknown> = claims;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      if (String(input) === issuer + "/jwks")
        return Response.json({ keys: [jwk] });
      expect(String(input)).toBe(issuer + "/oauth2/introspect");
      const body = new URLSearchParams(String(options?.body));
      expect(body.get("client_id")).toBe("mcp-hub-catalog");
      expect(body.get("token")).toBe(token);
      return Response.json({
        ...introspected,
        token_type: "Bearer",
        active: true,
      });
    });
    const request = () => get(resource, { Authorization: "Bearer " + token });
    await db
      .prepare("INSERT INTO hub_login_principal VALUES (?, ?, NULL)")
      .bind("https://auth.vocs.io", "preview-device-alice")
      .run();
    for (const grant of ["dashboard:manage", "models:read"])
      await db
        .prepare("INSERT INTO hub_login_permission VALUES (?, ?, ?)")
        .bind("https://auth.vocs.io", "preview-device-alice", grant)
        .run();
    const response = await preview.fetch(request(), enabled);
    expect(response.status).toBe(200);
    expect(
      (
        (await response.json()) as {
          connections: { accountScopes: string[] }[];
        }
      ).connections[0].accountScopes,
    ).toEqual(["models:read"]);
    // The flag-off production entry still serves nothing for the same token.
    expect((await preview.fetch(request(), live)).status).toBe(404);
    for (const changed of [
      { azp: "vocs-code", client_id: "vocs-code" },
      { client_id: "vocs-code" },
    ]) {
      introspected = { ...claims, ...changed };
      const rejected = await preview.fetch(request(), enabled);
      expect(rejected.status, JSON.stringify(changed)).toBe(401);
      expect(rejected.headers.get("WWW-Authenticate")).toContain(
        'error="invalid_token"',
      );
    }
  });
});
