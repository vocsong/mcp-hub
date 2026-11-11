import worker from "../src/index";
import type { Env } from "../src/types";
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  capabilityAuthEnabled,
  cleanupClients,
  handleClientManagement,
  readClientIdentity,
  readProductIdentity,
  type CapabilityEnv,
} from "../src/authorization";
import { hashLoginToken, handleLogin, VOCS_ISSUER } from "../src/login/worker";
import schema from "../migrations/login/0001_product_sessions.sql?raw";
import clientsSchema from "../migrations/login/0002_capability_clients.sql?raw";
const db = (env as unknown as { LOGIN_DB: D1Database }).LOGIN_DB;
const origin = "https://mcp.vocs.io";
const cfg: CapabilityEnv = {
  LOGIN_DB: db,
  PUBLIC_ORIGIN: origin,
  APP_MODE: "production",
  PRODUCT_LOGIN_ENABLED: "true",
  CAPABILITY_AUTH_ENABLED: "true",
};
const scopes = ["models:read", "speech:write", "audio:read"];
const cookie = (subject = "alice") =>
  "__Host-mcp.session=" + (subject === "alice" ? "a" : "b").repeat(43);
const req = (
  path: string,
  subject = "alice",
  body?: unknown,
  headers: Record<string, string> = {},
  method = body === undefined ? "GET" : "POST",
) =>
  new Request(origin + path, {
    method,
    headers: {
      cookie: cookie(subject),
      Origin: origin,
      "Content-Type": "application/json",
      "X-Vocs-Intent": "dashboard",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const manage = async (request: Request, settings = cfg) =>
  (await handleClientManagement(request, settings))!;
async function seed(
  subject = "alice",
  grants = ["dashboard:manage", ...scopes],
) {
  const now = Date.now();
  await db
    .prepare("INSERT INTO hub_login_principal VALUES (?, ?, NULL)")
    .bind(VOCS_ISSUER, subject)
    .run();
  await db
    .prepare("INSERT INTO hub_login_session VALUES (?, ?, ?, ?, ?, ?)")
    .bind(
      await hashLoginToken((subject === "alice" ? "a" : "b").repeat(43)),
      subject,
      VOCS_ISSUER,
      subject,
      now,
      now + 1_800_000,
    )
    .run();
  for (const permission of grants)
    await db
      .prepare("INSERT INTO hub_login_permission VALUES (?, ?, ?)")
      .bind(VOCS_ISSUER, subject, permission)
      .run();
}
async function issue(subject = "alice", clientId = "dots") {
  const response = await manage(
    req("/api/clients", subject, { clientId, scopes, consent: true }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    token: string;
    expiresAt: number;
    resource: string;
  };
}
const bearer = (
  token: string,
  path = "/openrouter",
  extra: Record<string, string> = {},
) =>
  new Request(origin + path, {
    headers: { Authorization: "Bearer " + token, ...extra },
  });
beforeAll(async () => {
  for (const statement of (schema + "\n" + clientsSchema)
    .split(";")
    .filter((s) => s.trim()))
    await db.prepare(statement).run();
});
beforeEach(async () => {
  for (const table of [
    "hub_client_token",
    "hub_login_permission",
    "hub_login_session",
    "hub_login_transaction",
    "hub_login_principal",
    "hub_login_rate",
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
});
describe("product capability authorization (real workerd/D1)", () => {
  it("is opt-in only and never infers grants from login", async () => {
    await seed("alice", []);
    expect((await manage(req("/api/clients"))).status).toBe(403);
    await expect(readProductIdentity(req("/api/status"), cfg)).rejects.toThrow(
      "insufficient_scope",
    );
    for (const change of [
      { CAPABILITY_AUTH_ENABLED: undefined },
      { CAPABILITY_AUTH_ENABLED: "false" },
      { APP_MODE: "local" },
      { PRODUCT_LOGIN_ENABLED: "false" },
    ]) {
      const settings = { ...cfg, ...change };
      expect(capabilityAuthEnabled(settings)).toBe(false);
      expect(
        await readProductIdentity(req("/api/status"), settings),
      ).toBeNull();
      expect((await manage(req("/api/clients"), settings)).status).toBe(503);
    }
  });
  it("isolates two subjects and does not allow a browser cookie on MCP", async () => {
    await seed();
    await seed("bob");
    const alice = await readProductIdentity(req("/api/status"), cfg);
    const bob = await readProductIdentity(req("/api/status", "bob"), cfg);
    expect(alice!.tenant).not.toBe(bob!.tenant);
    expect(alice!.dashboard).toBe(true);
    expect((await readProductIdentity(req("/audio/id"), cfg))!.tenant).toBe(
      alice!.tenant,
    );
    await expect(readProductIdentity(req("/openrouter"), cfg)).rejects.toThrow(
      "authentication_required",
    );
    expect(await readClientIdentity(req("/openrouter"), cfg)).toBeNull();
    for (const value of [
      "",
      cookie() + "; " + cookie(),
      "__Host-mcp.session=short",
    ]) {
      expect(
        (
          await manage(
            req("/api/clients", "alice", undefined, { cookie: value }),
          )
        ).status,
      ).toBe(401);
    }
  });
  it("issues exact-client, hashed, bounded, resource-pinned capabilities with metadata-only listing", async () => {
    await seed();
    await seed("bob");
    const issued = await issue();
    const other = await issue("bob", "vocs-code");
    expect(issued.token).toMatch(/^vmcp_[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(issued.resource).toBe(origin + "/openrouter");
    const rows = await db.prepare("SELECT * FROM hub_client_token").all();
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(JSON.stringify(rows)).not.toContain(other.token);
    const listed = (await (await manage(req("/api/clients"))).json()) as {
      clients: { id: string }[];
    };
    expect(listed.clients.map((x) => x.id)).toEqual([issued.id]);
    expect(JSON.stringify(listed)).not.toMatch(/token|session_hash/);
    const identity = await readClientIdentity(bearer(issued.token), cfg);
    expect(identity).toEqual({
      ...(await readProductIdentity(req("/api/status"), cfg)),
      scopes,
      dashboard: false,
    });
    expect(
      (await readClientIdentity(bearer(issued.token, "/audio/id"), cfg))!
        .dashboard,
    ).toBe(false);
    await expect(
      readClientIdentity(bearer(issued.token, "/api/status"), cfg),
    ).rejects.toThrow("insufficient_scope");
  });
  it("rejects missing consent, unsupported clients, unknown fields and scope escalation", async () => {
    await seed("alice", ["dashboard:manage", "models:read"]);
    for (const body of [
      { clientId: "dots", scopes, consent: true },
      { clientId: "dots", scopes: ["dashboard:manage"], consent: true },
      { clientId: "dots", scopes: [], consent: true },
      {
        clientId: "dots",
        scopes: ["models:read", "models:read"],
        consent: true,
      },
      { clientId: "other", scopes: ["models:read"], consent: true },
      { clientId: "dots", scopes: ["models:read"], consent: false },
      { clientId: "dots", scopes: ["models:read"] },
      {
        clientId: "dots",
        scopes: ["models:read"],
        consent: true,
        subject: "bob",
      },
    ])
      expect(
        (await manage(req("/api/clients", "alice", body))).status,
      ).toBeGreaterThanOrEqual(400);
    expect(
      (await db.prepare("SELECT * FROM hub_client_token").all()).results,
    ).toHaveLength(0);
  });
  it("requires exact origin and intent for mutations, rejects mixed identities and malformed bearer", async () => {
    await seed();
    const issued = await issue();
    for (const headers of [
      { Origin: "" },
      { Origin: "https://evil.test" },
      { "X-Vocs-Intent": "" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      expect(
        (
          await manage(
            req(
              "/api/clients",
              "alice",
              { clientId: "dots", scopes, consent: true },
              headers,
            ),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await manage(
            req(
              "/api/clients/" + issued.id,
              "alice",
              undefined,
              headers,
              "DELETE",
            ),
          )
        ).status,
      ).toBe(403);
    }
    for (const auth of [
      "Bearer short",
      "Basic vmcp_x",
      "Bearer " + issued.token + ", x",
    ])
      await expect(
        readClientIdentity(
          new Request(origin + "/openrouter", {
            headers: { Authorization: auth },
          }),
          cfg,
        ),
      ).rejects.toThrow("invalid_identity");
    expect(
      (
        await manage(
          req("/api/clients", "alice", undefined, {
            Authorization: "Bearer short",
          }),
        )
      ).status,
    ).toBe(401);
    await expect(
      readClientIdentity(
        bearer(issued.token, "/openrouter", { cookie: cookie() }),
        cfg,
      ),
    ).rejects.toThrow("invalid_identity");
    await expect(
      readClientIdentity(
        bearer(issued.token, "/openrouter", { Origin: "https://evil.test" }),
        cfg,
      ),
    ).rejects.toThrow("invalid_origin");
    await expect(
      readClientIdentity(
        new Request("https://evil.test/openrouter", {
          headers: { Authorization: "Bearer " + issued.token },
        }),
        cfg,
      ),
    ).rejects.toThrow("invalid_host");
  });
  it.each([
    "session expiry",
    "logout",
    "suspension",
    "scope removal",
    "dashboard removal",
    "token expiry",
    "audience change",
    "freshness expiry",
  ])("invalidates immediately on %s", async (reason) => {
    await seed();
    const issued = await issue();
    switch (reason) {
      case "session expiry":
        await db
          .prepare("UPDATE hub_login_session SET expires_at = ?")
          .bind(Date.now() - 1)
          .run();
        break;
      case "logout":
        expect(
          (await handleLogin(req("/login/logout", "alice", {}), cfg))!.status,
        ).toBe(200);
        break;
      case "suspension":
        await db
          .prepare("UPDATE hub_login_principal SET disabled_at = ?")
          .bind(Date.now())
          .run();
        break;
      case "scope removal":
        await db
          .prepare(
            "DELETE FROM hub_login_permission WHERE permission = 'speech:write'",
          )
          .run();
        break;
      case "dashboard removal":
        await db
          .prepare(
            "DELETE FROM hub_login_permission WHERE permission = 'dashboard:manage'",
          )
          .run();
        break;
      case "token expiry":
        await db
          .prepare("UPDATE hub_client_token SET expires_at = ?")
          .bind(Date.now() - 1)
          .run();
        break;
      case "audience change":
        await db
          .prepare(
            "UPDATE hub_client_token SET resource = 'https://evil.test/openrouter'",
          )
          .run();
        break;
      case "freshness expiry":
        await db
          .prepare("UPDATE hub_login_session SET authenticated_at = ?")
          .bind(Date.now() - 300_001)
          .run();
        break;
    }
    await expect(readClientIdentity(bearer(issued.token), cfg)).rejects.toThrow(
      "invalid_identity",
    );
  });
  it("caps expiry to both product session and fresh source authentication; old authentication cannot mint", async () => {
    await seed();
    const cap = Date.now() + 30_000;
    await db
      .prepare("UPDATE hub_login_session SET expires_at = ?")
      .bind(cap)
      .run();
    expect((await issue()).expiresAt).toBe(cap);
    await db
      .prepare(
        "UPDATE hub_login_session SET authenticated_at = ?, expires_at = ?",
      )
      .bind(Date.now() - 290_000, Date.now() + 600_000)
      .run();
    expect((await issue()).expiresAt).toBeLessThanOrEqual(Date.now() + 10_000);
    await db
      .prepare("UPDATE hub_login_session SET authenticated_at = ?")
      .bind(Date.now() - 300_001)
      .run();
    expect(
      (
        await manage(
          req("/api/clients", "alice", {
            clientId: "dots",
            scopes,
            consent: true,
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("revokes only owner tokens and bounds active issuance atomically", async () => {
    await seed();
    await seed("bob");
    const issued = await issue();
    expect(
      (
        await manage(
          req("/api/clients/" + issued.id, "bob", undefined, {}, "DELETE"),
        )
      ).status,
    ).toBe(404);
    expect(await readClientIdentity(bearer(issued.token), cfg)).not.toBeNull();
    expect(
      (
        await manage(
          req("/api/clients/" + issued.id, "alice", undefined, {}, "DELETE"),
        )
      ).status,
    ).toBe(200);
    await expect(readClientIdentity(bearer(issued.token), cfg)).rejects.toThrow(
      "invalid_identity",
    );
    await cleanupClients(cfg);
    expect(
      (await db.prepare("SELECT * FROM hub_client_token").all()).results,
    ).toHaveLength(0);
    for (let i = 0; i < 19; i++) await issue();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        manage(
          req("/api/clients", "alice", {
            clientId: "dots",
            scopes,
            consent: true,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });
  it("logout racing issuance leaves no usable credential", async () => {
    await seed();
    const [issued, loggedOut] = await Promise.all([
      manage(
        req("/api/clients", "alice", {
          clientId: "dots",
          scopes,
          consent: true,
        }),
      ),
      handleLogin(req("/login/logout", "alice", {}), cfg),
    ]);
    expect(loggedOut!.status).toBe(200);
    if (issued.status === 201) {
      const token = ((await issued.json()) as { token: string }).token;
      await expect(readClientIdentity(bearer(token), cfg)).rejects.toThrow(
        "invalid_identity",
      );
    } else expect([401, 403]).toContain(issued.status);
    expect(
      (await db.prepare("SELECT * FROM hub_client_token").all()).results,
    ).toHaveLength(0);
  });
});

describe("integrated capability router", () => {
  const run = (request: Request) =>
    worker.fetch(request, { ...env, ...cfg } as Env);
  it("enforces cookie and scoped client boundaries through the real Worker router", async () => {
    await seed("alice", ["dashboard:manage", "models:read"]);
    expect((await run(req("/api/status"))).status).toBe(200);
    const speech = {
      text: "Hello",
      voice: "en_paul_neutral",
      requestId: crypto.randomUUID(),
    };
    expect((await run(req("/api/speech", "alice", speech))).status).toBe(403);
    expect((await run(req("/openrouter", "alice", {}))).status).toBe(401);
    const result = await run(
      req("/api/clients", "alice", {
        clientId: "dots",
        scopes: ["models:read"],
        consent: true,
      }),
    );
    expect(result.status).toBe(201);
    const { token } = (await result.json()) as { token: string };
    const rpc = async (method: string, params = {}) => {
      const result = await run(
        new Request(origin + "/openrouter", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      expect(result.status).toBe(200);
      return (await result.json()) as {
        result?: { tools?: { name: string }[]; isError?: boolean };
        error?: unknown;
      };
    };
    expect((await rpc("tools/list")).result!.tools!.map((t) => t.name)).toEqual(
      ["openrouter_models", "openrouter_speech"],
    );
    const denied = await rpc("tools/call", {
      name: "openrouter_speech",
      arguments: speech,
    });
    expect(!!denied.error || denied.result?.isError === true).toBe(true);
    expect(
      (await run(bearer(token, "/audio/" + crypto.randomUUID()))).status,
    ).toBe(403);
    expect((await run(bearer(token, "/api/status"))).status).toBe(403);
    expect((await run(req("/login/logout", "alice", {}))).status).toBe(200);
    expect((await run(req("/api/status"))).status).toBe(401);
    expect((await run(bearer(token))).status).toBe(401);
  });
  it("requires fresh source authentication for browser mutations while reads and revocation remain available", async () => {
    await seed();
    const issued = await issue();
    await db
      .prepare("UPDATE hub_login_session SET authenticated_at = ?")
      .bind(Date.now() - 300_001)
      .run();
    expect((await run(req("/api/status"))).status).toBe(200);
    expect(
      (await run(req("/api/key", "alice", undefined, {}, "DELETE"))).status,
    ).toBe(200);
    expect(
      (
        await run(
          req(
            "/api/audio/" + crypto.randomUUID(),
            "alice",
            undefined,
            {},
            "DELETE",
          ),
        )
      ).status,
    ).toBe(404);
    for (const path of [
      "/api/key",
      "/api/policy",
      "/api/speech",
      "/api/approve",
    ]) {
      const result = await run(req(path, "alice", {}));
      expect(result.status).toBe(401);
      expect(await result.json()).toEqual({
        error: "fresh_authentication_required",
      });
    }
    expect(
      (
        await run(
          req("/api/clients/" + issued.id, "alice", undefined, {}, "DELETE"),
        )
      ).status,
    ).toBe(200);
  });
});
