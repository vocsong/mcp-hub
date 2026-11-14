import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  readNativeCatalogPrincipal,
  type NativeCatalogEnv,
} from "../src/native-catalog";
import { handleAccountCatalog, type CapabilityEnv } from "../src/authorization";
import worker from "../src/index";
import type { Env } from "../src/types";
import loginSchema from "../migrations/login/0001_product_sessions.sql?raw";
const origin = "https://mcp.vocs.io";
const issuer = "https://auth.vocs.io/api/auth";
const resource = origin + "/api/connections";
const db = (env as unknown as { LOGIN_DB: D1Database }).LOGIN_DB;
const cfg: NativeCatalogEnv & CapabilityEnv = {
  PUBLIC_ORIGIN: origin,
  NATIVE_CATALOG_ENABLED: "true",
  NATIVE_CATALOG_CLIENT_SECRET: "synthetic-service-secret",
  APP_MODE: "production",
  PRODUCT_LOGIN_ENABLED: "true",
  CAPABILITY_AUTH_ENABLED: "true",
  LOGIN_DB: db,
};
let key: CryptoKey, jwk: Record<string, unknown>;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  key = pair.privateKey;
  jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "fixture",
    alg: "ES256",
    use: "sig",
  };
  for (const sql of loginSchema.split(";").filter((s) => s.trim()))
    await db.prepare(sql).run();
});
afterEach(() => vi.restoreAllMocks());
async function fixture(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    sub: "catalog-alice",
    aud: resource,
    iat: now,
    exp: now + 300,
    sid: "source-session",
    azp: "vocs-code",
    scope: "catalog:read",
    ...overrides,
  };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "fixture", typ: "at+jwt" })
    .sign(key);
  let active = true;
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, options) => {
      const url = String(input);
      expect(options?.redirect).toBe("manual");
      if (url === issuer + "/jwks") {
        expect(String(options?.body)).not.toContain("synthetic-service-secret");
        return Response.json({ keys: [jwk] });
      }
      expect(url).toBe(issuer + "/oauth2/introspect");
      expect(options?.method).toBe("POST");
      const body = new URLSearchParams(String(options?.body));
      expect(body.get("client_id")).toBe("mcp-hub-catalog");
      expect(body.get("client_secret")).toBe("synthetic-service-secret");
      expect(body.get("token")).toBe(token);
      return Response.json({
        ...claims,
        client_id: "vocs-code",
        token_type: "Bearer",
        active,
      });
    });
  const request = () =>
    new Request(resource, { headers: { Authorization: "Bearer " + token } });
  return {
    claims,
    token,
    request,
    network,
    revoke() {
      active = false;
    },
  };
}
describe("native catalog resource boundary", () => {
  it("advertises only the pinned native catalog resource before the legacy MCP metadata router", async () => {
    const url =
      origin + "/.well-known/oauth-protected-resource/api/connections";
    const response = await worker.fetch(new Request(url), {
      ...cfg,
      OAUTH_ENABLED: "true",
    } as Env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["catalog:read"],
      bearer_methods_supported: ["header"],
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(
      (
        await worker.fetch(new Request(url), {
          ...cfg,
          NATIVE_CATALOG_ENABLED: undefined,
        } as Env)
      ).status,
    ).toBe(503);
    expect(
      (
        await worker.fetch(
          new Request(url + "?resource=https://evil.example"),
          cfg as Env,
        )
      ).status,
    ).toBe(400);
  });

  it("verifies JWT then introspects every request and maps only the pinned identity realm", async () => {
    const f = await fixture();
    expect(await readNativeCatalogPrincipal(f.request(), cfg)).toEqual({
      issuer: "https://auth.vocs.io",
      subject: "catalog-alice",
    });
    f.revoke();
    await expect(readNativeCatalogPrincipal(f.request(), cfg)).rejects.toThrow(
      "invalid_identity",
    );
    expect(f.network).toHaveBeenCalledTimes(4);
  });
  it("rejects wrong issuer, resource, scope, client, absent session and invalid lifetime before introspection", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const override of [
      { iss: "https://elsewhere.example/api/auth" },
      { aud: origin + "/openrouter" },
      { aud: [resource] },
      { scope: "catalog:read speech:write" },
      { azp: "other-app" },
      { sid: "" },
      { cnf: { jkt: "proof-bound" } },
      { iat: now + 60, exp: now + 300 },
      { exp: now + 301 },
      { exp: now - 1 },
    ]) {
      const f = await fixture(override);
      await expect(
        readNativeCatalogPrincipal(f.request(), cfg),
      ).rejects.toThrow();
      expect(
        f.network.mock.calls.every(([url]) => String(url) === issuer + "/jwks"),
      ).toBe(true);
      vi.restoreAllMocks();
    }
  });
  it("rejects disabled setup, mixed credentials and route overrides without network", async () => {
    const f = await fixture();
    await expect(
      readNativeCatalogPrincipal(f.request(), {
        ...cfg,
        NATIVE_CATALOG_ENABLED: undefined,
      }),
    ).rejects.toThrow("not_enabled");
    await expect(
      readNativeCatalogPrincipal(f.request(), {
        ...cfg,
        NATIVE_CATALOG_CLIENT_SECRET: undefined,
      }),
    ).rejects.toThrow("not_enabled");
    for (const headers of [
      { Cookie: "arbitrary=value" },
      { "Cf-Access-Jwt-Assertion": "other" },
    ])
      await expect(
        readNativeCatalogPrincipal(
          new Request(resource, {
            headers: { Authorization: "Bearer " + f.token, ...headers },
          }),
          cfg,
        ),
      ).rejects.toThrow("invalid_identity");
    await expect(
      readNativeCatalogPrincipal(
        new Request(resource + "?user=bob", {
          headers: { Authorization: "Bearer " + f.token },
        }),
        cfg,
      ),
    ).rejects.toThrow("invalid_request");
    expect(f.network).not.toHaveBeenCalled();
    const rejected = (await handleAccountCatalog(
      new Request(resource, { headers: { Authorization: "Bearer invalid" } }),
      cfg,
    ))!;
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(rejected.headers.get("WWW-Authenticate")).toContain(
      origin + "/.well-known/oauth-protected-resource/api/connections",
    );
  });
  it("fails closed on introspection failure, redirects, oversized or mismatched responses", async () => {
    for (const response of [
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example" },
      }),
      new Response(null, { status: 503 }),
      Response.json({ active: true, sub: "other-user" }),
      Response.json({ padding: "x".repeat(17000) }),
    ]) {
      const f = await fixture();
      f.network.mockImplementation(async (input) =>
        String(input).endsWith("/jwks")
          ? Response.json({ keys: [jwk] })
          : response,
      );
      await expect(
        readNativeCatalogPrincipal(f.request(), cfg),
      ).rejects.toThrow();
      vi.restoreAllMocks();
    }
  });
  it("does not downgrade proof-bound tokens or accept an introspected session swap", async () => {
    for (const changed of [
      { token_type: "DPoP" },
      { cnf: { jkt: "proof-bound" } },
      { sid: "different-session" },
      { client_id: "other-app" },
    ]) {
      const f = await fixture();
      f.network.mockImplementation(async (input) =>
        String(input).endsWith("/jwks")
          ? Response.json({ keys: [jwk] })
          : Response.json({
              ...f.claims,
              active: true,
              client_id: "vocs-code",
              token_type: "Bearer",
              ...changed,
            }),
      );
      await expect(
        readNativeCatalogPrincipal(f.request(), cfg),
      ).rejects.toThrow("invalid_identity");
      vi.restoreAllMocks();
    }
  });

  it("still requires current Hub principal and account permissions; bearer grants cannot widen them", async () => {
    const f = await fixture();
    expect((await handleAccountCatalog(f.request(), cfg))!.status).toBe(403);
    await db
      .prepare("INSERT INTO hub_login_principal VALUES (?, ?, NULL)")
      .bind("https://auth.vocs.io", "catalog-alice")
      .run();
    for (const grant of ["dashboard:manage", "models:read"])
      await db
        .prepare("INSERT INTO hub_login_permission VALUES (?, ?, ?)")
        .bind("https://auth.vocs.io", "catalog-alice", grant)
        .run();
    const response = (await handleAccountCatalog(f.request(), cfg))!;
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as any).connections[0].accountScopes,
    ).toEqual(["models:read"]);
    await db
      .prepare(
        "UPDATE hub_login_principal SET disabled_at = ? WHERE subject = ?",
      )
      .bind(Date.now(), "catalog-alice")
      .run();
    expect((await handleAccountCatalog(f.request(), cfg))!.status).toBe(403);
  });
});
