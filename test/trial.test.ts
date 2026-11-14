import { env, runInDurableObject } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { unseal } from "../src/security";
import type { Env } from "../src/types";
const bindings = env as Env;
const fakeKey = "sk-or-v1-fixture-not-a-real-secret-00000000000000";
const input = (text = "Private trial") => ({
  text,
  voice: "en_paul_neutral" as const,
  requestId: crypto.randomUUID(),
});
async function production(live = true) {
  const name = crypto.randomUUID(),
    stub = bindings.TENANTS.getByName(name);
  await stub.bindTenant(name);
  await runInDurableObject(stub, async (instance) => {
    // Each DO gets a private env override for this test, without changing Worker bindings.
    Reflect.set(instance, "env", {
      ...bindings,
      APP_MODE: "production",
      LIVE_PROVIDER: live ? "enabled" : "disabled",
      PRICE_VERIFIED_UNTIL: new Date(Date.now() + 3600000).toISOString(),
    });
  });
  return { name, stub };
}
afterEach(() => vi.restoreAllMocks());
describe("bounded production trial", () => {
  it("requires storage consent and retains only tenant-bound ciphertext", async () => {
    const { name, stub } = await production(false);
    await expect(
      Promise.resolve(stub.connectKey(name, { key: fakeKey, consent: false })),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(stub.connectKey(name, { key: "bad key", consent: true })),
    ).rejects.toThrow();
    await stub.connectKey(name, { key: fakeKey, consent: true });
    const saved = await runInDurableObject(
      stub,
      async (_, state) =>
        state.storage.sql
          .exec<{ value: string }>("SELECT value FROM kv WHERE key='key'")
          .one().value,
    );
    expect(saved).not.toContain(fakeKey);
    const record = JSON.parse(saved);
    expect(await unseal(record.encrypted, name, bindings)).toBe(fakeKey);
    expect(JSON.stringify(await stub.status())).not.toContain("encrypted");
    expect((await stub.status()).keyConsent!.consentedAt).toBeGreaterThan(0);
    await stub.disconnectKey();
    expect((await stub.status()).keyConsent).toBeNull();
    expect((await stub.status()).keyConnected).toBe(false);
  });
  it("never produces a demo success when production live calls are disabled", async () => {
    const { name, stub } = await production(false);
    await stub.connectKey(name, { key: fakeKey, consent: true });
    await expect(Promise.resolve(stub.speech(name, input()))).rejects.toThrow(
      "live_provider_disabled",
    );
    expect((await stub.status()).trialReserved).toBe(0);
  });
  it("forces one-hour retention, explicit approval and at most ten cents", async () => {
    const { stub } = await production();
    expect((await stub.status()).policy).toEqual({
      dailyMicros: 100000,
      approvalRequired: true,
      retentionHours: 1,
    });
    for (const policy of [
      { dailyMicros: 100001, approvalRequired: true, retentionHours: 1 },
      { dailyMicros: 100000, approvalRequired: false, retentionHours: 1 },
      { dailyMicros: 100000, approvalRequired: true, retentionHours: 2 },
    ])
      await expect(
        Promise.resolve(stub.configurePolicy(policy)),
      ).rejects.toThrow("trial_policy_required");
  });
  it("bounds UTF-8 text and requires a key before preparing", async () => {
    const { name, stub } = await production();
    await expect(Promise.resolve(stub.speech(name, input()))).rejects.toThrow(
      "provider_key_required",
    );
    await stub.connectKey(name, { key: fakeKey, consent: true });
    await expect(
      Promise.resolve(stub.speech(name, input("😀".repeat(76)))),
    ).rejects.toThrow("trial_text_too_long");
    expect((await stub.speech(name, input("😀".repeat(75)))).status).toBe(
      "pending",
    );
  });
  it("replacement and disconnect invalidate unexecuted approvals", async () => {
    const { name, stub } = await production();
    await stub.connectKey(name, { key: fakeKey, consent: true });
    const a = input();
    await stub.speech(name, a);
    await stub.approve(a.requestId, a);
    await stub.connectKey(name, { key: fakeKey + "x", consent: true });
    expect((await stub.speech(name, a)).status).toBe("cancelled");
    const b = input();
    await stub.speech(name, b);
    await stub.approve(b.requestId, b);
    await stub.disconnectKey();
    expect((await stub.speech(name, b)).status).toBe("cancelled");
    expect((await stub.status()).trialReserved).toBe(0);
  });
  it("a failed replacement cancels old approvals without consuming the trial", async () => {
    const { name, stub } = await production();
    await stub.connectKey(name, { key: fakeKey, consent: true });
    const a = input();
    await stub.speech(name, a);
    await stub.approve(a.requestId, a);
    await runInDurableObject(stub, async (instance) => {
      const cfg = Reflect.get(instance, "env");
      const saved = cfg.KEY_ENCRYPTION_KEY;
      cfg.KEY_ENCRYPTION_KEY = undefined;
      await expect(
        instance.connectKey(name, {
          key: fakeKey + "replacement",
          consent: true,
        }),
      ).rejects.toThrow("encryption_not_configured");
      cfg.KEY_ENCRYPTION_KEY = saved;
    });
    expect((await stub.speech(name, a)).status).toBe("cancelled");
    expect((await stub.status()).trialReserved).toBe(0);
    expect((await stub.status()).keyConnected).toBe(true);
  });
  it("disconnect wins against a key encryption already in progress", async () => {
    const { name, stub } = await production();
    await runInDurableObject(stub, async (instance) => {
      const saving = instance.connectKey(name, { key: fakeKey, consent: true });
      await instance.disconnectKey();
      await expect(saving).rejects.toThrow("key_update_cancelled");
    });
    expect((await stub.status()).keyConnected).toBe(false);
  });
  it("retains the one-call reservation on uncertain outcomes and forbids fresh-ID retries", async () => {
    const { name, stub } = await production();
    await stub.connectKey(name, { key: fakeKey, consent: true });
    // Mock inside DO execution context. No network or paid request occurs.
    await runInDurableObject(stub, async (instance) => {
      const outbound = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("uncertain"));
      const a = input();
      await instance.speech(name, a);
      await instance.approve(a.requestId, a);
      expect((await instance.speech(name, a)).status).toBe("uncertain");
      expect((await instance.speech(name, a)).status).toBe("uncertain");
      const b = input();
      await instance.speech(name, b);
      await instance.approve(b.requestId, b);
      await expect(instance.speech(name, b)).rejects.toThrow(
        "trial_budget_exhausted",
      );
      expect(outbound).toHaveBeenCalledTimes(1);
      outbound.mockRestore();
    });
    expect((await stub.status()).trialReserved).toBe(100000);
  });
  it("does not consume the trial for a known expired price-review gate", async () => {
    const { name, stub } = await production();
    await stub.connectKey(name, { key: fakeKey, consent: true });
    const a = input();
    await stub.speech(name, a);
    await stub.approve(a.requestId, a);
    await runInDurableObject(stub, async (instance) => {
      Reflect.get(instance, "env").PRICE_VERIFIED_UNTIL = "2020-01-01";
      await expect(instance.speech(name, a)).rejects.toThrow(
        "price_review_required",
      );
    });
    expect((await stub.status()).trialReserved).toBe(0);
  });
  it("completes a mocked approved request with private one-hour audio and no retained text", async () => {
    const { name, stub } = await production();
    await stub.connectKey(name, { key: fakeKey, consent: true });
    await runInDurableObject(stub, async (instance, state) => {
      const outbound = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("mock-audio", {
          headers: { "Content-Type": "audio/mpeg" },
        }),
      );
      const a = input();
      await instance.speech(name, a);
      await instance.approve(a.requestId, a);
      const done = await instance.speech(name, a);
      expect(done.status).toBe("complete");
      expect(done.expires! - Date.now()).toBeLessThanOrEqual(3600000);
      const rows = JSON.stringify(
        state.storage.sql.exec("SELECT * FROM kv").toArray(),
      );
      expect(rows).not.toContain(a.text);
      expect(rows).not.toContain(fakeKey);
      expect(outbound).toHaveBeenCalledTimes(1);
      outbound.mockRestore();
    });
  });
});
