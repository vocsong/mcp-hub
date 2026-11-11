import {
  env,
  SELF,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { seal, unseal, identity, digest } from "../src/security";
import type { Env } from "../src/types";
const bindings = env as Env;
const input = (text = "Hello from Vocs") => ({
  requestId: crypto.randomUUID(),
  text,
  voice: "en_paul_neutral" as const,
});
async function fresh() {
  const name = crypto.randomUUID();
  const stub = bindings.TENANTS.getByName(name);
  await stub.bindTenant(name);
  return { stub, name };
}
const api = (path: string, data?: unknown, method = data ? "POST" : "GET") =>
  SELF.fetch("http://localhost:8787" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Vocs-Intent": "dashboard",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
describe("tenant execution", () => {
  it("requires approval, retains no text, generates private WAV, and replays once", async () => {
    const { stub, name } = await fresh();
    const req = input();
    expect((await stub.speech(name, req)).status).toBe("pending");
    expect(JSON.stringify(await stub.status())).not.toContain(req.text);
    await stub.approve(req.requestId, req);
    const done = await stub.speech(name, req);
    expect(done.status).toBe("complete");
    expect(await stub.speech(name, req)).toEqual(done);
    expect((await stub.status()).reservedToday).toBe(100000);
    const audio = await stub.audio(name, done.audioPath!.split("/").pop()!);
    expect(audio.headers.get("Content-Type")).toBe("audio/wav");
    expect((await audio.arrayBuffer()).byteLength).toBe(16044);
  });
  it("rejects changed arguments for the same request ID", async () => {
    const { stub, name } = await fresh();
    const req = input();
    await stub.speech(name, req);
    await expect(
      Promise.resolve(stub.speech(name, { ...req, text: "Changed" })),
    ).rejects.toThrow("idempotency_conflict");
  });
  it("does not share approval or audio between tenants", async () => {
    const a = await fresh(),
      b = await fresh(),
      req = input();
    await a.stub.speech(a.name, req);
    await expect(
      Promise.resolve(b.stub.approve(req.requestId, req)),
    ).rejects.toThrow("not_found");
    await a.stub.approve(req.requestId, req);
    const done = await a.stub.speech(a.name, req);
    await expect(
      Promise.resolve(b.stub.audio(b.name, done.audioPath!.split("/").pop()!)),
    ).rejects.toThrow("audio_expired_or_not_found");
  });
  it("atomically limits concurrent calls to budget", async () => {
    const { stub, name } = await fresh();
    await stub.configurePolicy({
      dailyMicros: 100000,
      approvalRequired: false,
      retentionHours: 1,
    });
    const results = await Promise.allSettled([
      stub.speech(name, input()),
      stub.speech(name, input()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stub.status()).reservedToday).toBe(100000);
  });
  it("concurrent duplicate dispatch reserves once", async () => {
    const { stub, name } = await fresh();
    await stub.configurePolicy({
      dailyMicros: 1000000,
      approvalRequired: false,
      retentionHours: 1,
    });
    const req = input();
    await Promise.all([stub.speech(name, req), stub.speech(name, req)]);
    expect((await stub.status()).reservedToday).toBe(100000);
    expect((await stub.status()).jobs).toHaveLength(1);
  });
  it("rejects oversized UTF-8 and unknown provider fields", async () => {
    const { stub, name } = await fresh();
    await expect(
      Promise.resolve(stub.speech(name, input("😀".repeat(600)))),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(stub.speech(name, { ...input(), provider: "evil" })),
    ).rejects.toThrow();
  });
  it("refuses real keys in demo", async () => {
    const { stub, name } = await fresh();
    await expect(
      Promise.resolve(
        stub.connectKey(name, {
          key: "sk-or-test-not-a-secret",
          consent: true,
        }),
      ),
    ).rejects.toThrow("real_keys_forbidden_in_demo");
  });
  it("deletes audio immediately and retains idempotency tombstone", async () => {
    const { stub, name } = await fresh();
    await stub.configurePolicy({
      dailyMicros: 1000000,
      approvalRequired: false,
      retentionHours: 1,
    });
    const req = input();
    const done = await stub.speech(name, req);
    const id = done.audioPath!.split("/").pop()!;
    await stub.deleteAudio(name, id);
    await expect(Promise.resolve(stub.audio(name, id))).rejects.toThrow();
    expect((await stub.speech(name, req)).status).toBe("complete");
    expect((await stub.status()).reservedToday).toBe(100000);
  });
  it("requires exact content before approval", async () => {
    const { stub, name } = await fresh(),
      req = input();
    await stub.speech(name, req);
    await expect(
      Promise.resolve(
        stub.approve(req.requestId, { ...req, text: "different" }),
      ),
    ).rejects.toThrow("approval_content_mismatch");
  });
  it("traffic cannot push cleanup alarm later", async () => {
    const { stub, name } = await fresh();
    await stub.speech(name, input());
    const before = await runInDurableObject(stub, async (_, state) =>
      state.storage.getAlarm(),
    );
    await stub.speech(name, input());
    expect(
      await runInDurableObject(stub, async (_, state) =>
        state.storage.getAlarm(),
      ),
    ).toBe(before);
  });
  it("schedules physical audio cleanup at the nearest expiry", async () => {
    const { stub, name } = await fresh();
    const req = input();
    await stub.speech(name, req);
    await stub.approve(req.requestId, req);
    await stub.speech(name, req);
    const expires = Date.now() + 60000;
    await runInDurableObject(stub, async (_, state) => {
      const row = state.storage.sql
        .exec<{ value: string }>(
          "SELECT value FROM kv WHERE key=?",
          "job:" + req.requestId,
        )
        .one();
      const job = JSON.parse(row.value);
      job.audioExpires = expires;
      state.storage.sql.exec(
        "UPDATE kv SET value=? WHERE key=?",
        JSON.stringify(job),
        "job:" + req.requestId,
      );
    });
    await stub.speech(name, input());
    expect(
      await runInDurableObject(stub, async (_, state) =>
        state.storage.getAlarm(),
      ),
    ).toBeLessThanOrEqual(expires);
  });
  it("fails expired approvals", async () => {
    const { stub, name } = await fresh(),
      req = input();
    await stub.speech(name, req);
    await runInDurableObject(stub, async (_, state) => {
      const row = state.storage.sql
        .exec<{ value: string }>(
          "SELECT value FROM kv WHERE key=?",
          "job:" + req.requestId,
        )
        .one();
      const job = JSON.parse(row.value);
      job.expires = 1;
      state.storage.sql.exec(
        "UPDATE kv SET value=? WHERE key=?",
        JSON.stringify(job),
        "job:" + req.requestId,
      );
    });
    await expect(
      Promise.resolve(stub.approve(req.requestId, req)),
    ).rejects.toThrow("approval_expired");
  });
  it("alarm removes expired objects and blocks download immediately", async () => {
    const { stub, name } = await fresh();
    await stub.configurePolicy({
      dailyMicros: 1000000,
      approvalRequired: false,
      retentionHours: 1,
    });
    const req = input(),
      done = await stub.speech(name, req),
      id = done.audioPath!.split("/").pop()!;
    await runInDurableObject(stub, async (_, state) => {
      const row = state.storage.sql
        .exec<{ value: string }>(
          "SELECT value FROM kv WHERE key=?",
          "job:" + req.requestId,
        )
        .one();
      const j = JSON.parse(row.value);
      j.audioExpires = 1;
      state.storage.sql.exec(
        "UPDATE kv SET value=? WHERE key=?",
        JSON.stringify(j),
        "job:" + req.requestId,
      );
    });
    await expect(Promise.resolve(stub.audio(name, id))).rejects.toThrow();
    await runDurableObjectAlarm(stub);
    expect(await bindings.AUDIO.head(name + "/" + id)).toBeNull();
  });
});
describe("security and HTTP", () => {
  it("encrypts keys with tenant-bound authenticated encryption", async () => {
    const cipher = await seal("test-key-not-secret", "alice", bindings);
    expect(cipher).not.toContain("test-key");
    expect(await unseal(cipher, "alice", bindings)).toBe("test-key-not-secret");
    await expect(
      Promise.resolve(unseal(cipher, "bob", bindings)),
    ).rejects.toThrow();
  });
  it("fails closed outside configured local origin and production config", async () => {
    expect((await SELF.fetch("http://evil.test/")).status).toBe(403);
    await expect(
      Promise.resolve(
        identity(new Request("https://mcp.vocs.io/"), {
          ...bindings,
          APP_MODE: "production",
          PUBLIC_ORIGIN: "https://mcp.vocs.io",
        }),
      ),
    ).rejects.toThrow("not_configured");
  });
  it("rejects hostile origins and missing intent on mutations", async () => {
    expect(
      (
        await SELF.fetch("http://localhost:8787/api/status", {
          headers: { Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await SELF.fetch("http://localhost:8787/api/key", { method: "DELETE" }))
        .status,
    ).toBe(403);
  });
  it("serves secured dashboard and rejects oversized streamed body", async () => {
    const r = await api("/dashboard");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(await r.text()).toContain("One home for");
    expect((await api("/api/speech", { text: "x".repeat(20000) })).status).toBe(
      413,
    );
  });
  it("speaks real MCP initialize and tools/list", async () => {
    const rpc = async (method: string, params = {}) => {
      const r = await SELF.fetch("http://localhost:8787/openrouter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      expect(r.status).toBe(200);
      return r.json() as Promise<{ result: any }>;
    };
    expect(
      (
        await rpc("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        })
      ).result.serverInfo.name,
    ).toBe("vocs-openrouter");
    expect(
      (await rpc("tools/list")).result.tools.map((t: any) => t.name),
    ).toEqual(["openrouter_models", "openrouter_speech"]);
  });
});
