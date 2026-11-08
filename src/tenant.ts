import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { requestDigest, seal, unseal } from "./security";
import { synthesize } from "./provider";
import {
  defaults,
  Fault,
  MODEL,
  RESERVATION,
  type Env,
  type Job,
  type Policy,
} from "./types";
export const speechSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (v) => new TextEncoder().encode(v).length <= 2000,
        "Maximum 2000 UTF-8 bytes",
      ),
    voice: z.literal("en_paul_neutral").default("en_paul_neutral"),
    requestId: z.string().uuid(),
  })
  .strict();
const policySchema = z
  .object({
    dailyMicros: z.number().int().min(0).max(10_000_000),
    approvalRequired: z.boolean(),
    retentionHours: z.number().int().min(1).max(24),
  })
  .strict();
export class Tenant extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  private get<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)
      .toArray()[0];
    return row ? JSON.parse(row.value) : undefined;
  }
  private put(key: string, value: unknown) {
    this.ctx.storage.sql.exec(
      "INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  }
  private remove(key: string) {
    this.ctx.storage.sql.exec("DELETE FROM kv WHERE key=?", key);
  }
  private jobs() {
    return this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM kv WHERE key LIKE 'job:%'")
      .toArray()
      .map((r) => JSON.parse(r.value) as Job);
  }
  private policy() {
    return this.get<Policy>("policy") ?? defaults;
  }
  async status() {
    return {
      policy: this.policy(),
      keyConnected: !!this.get("key"),
      model: MODEL,
      mode: this.env.LIVE_PROVIDER === "enabled" ? "live" : "demo-tone",
      jobs: this.jobs().map(({ digest, ...job }) => job),
      reservedToday:
        this.get<number>("usage:" + new Date().toISOString().slice(0, 10)) ?? 0,
    };
  }
  async configurePolicy(value: unknown) {
    const p = policySchema.parse(value);
    this.put("policy", p);
    return p;
  }
  async connectKey(tenant: string, value: unknown) {
    if (this.env.APP_MODE !== "production")
      throw new Fault("real_keys_forbidden_in_demo");
    const data = z
      .object({ key: z.string().min(20).max(512), consent: z.literal(true) })
      .strict()
      .parse(value);
    const encrypted = await seal(data.key, tenant, this.env);
    this.put("key", { encrypted, consentedAt: Date.now(), version: 1 });
    return { connected: true };
  }
  async disconnectKey() {
    this.remove("key");
    return { connected: false };
  }
  async approve(id: string, preview: unknown) {
    const input = speechSchema.parse(preview);
    if (input.requestId !== id)
      throw new Fault("approval_content_mismatch", 409);
    const tenant = this.get<string>("tenant");
    if (!tenant) throw new Fault("tenant_missing", 403);
    const hash = await requestDigest(
      JSON.stringify({ text: input.text, voice: input.voice, model: MODEL }),
      tenant,
      this.env,
    );
    const job = this.get<Job>("job:" + id);
    if (!job) throw new Fault("not_found", 404);
    if (job.digest !== hash) throw new Fault("approval_content_mismatch", 409);
    if (job.expires < Date.now()) throw new Fault("approval_expired", 410);
    if (job.status !== "pending") throw new Fault("not_pending", 409);
    job.status = "approved";
    this.put("job:" + id, job);
    return { id, status: job.status };
  }
  async speech(tenant: string, value: unknown) {
    const input = speechSchema.parse(value);
    const hash = await requestDigest(
      JSON.stringify({ text: input.text, voice: input.voice, model: MODEL }),
      tenant,
      this.env,
    );
    const now = Date.now(),
      key = "job:" + input.requestId;
    // No await inside read/modify/write: SQL mutation plus reservation is atomic.
    const action = this.ctx.storage.transactionSync(() => {
      let job = this.get<Job>(key);
      if (job && job.digest !== hash)
        throw new Fault("idempotency_conflict", 409);
      if (job && ["running", "complete", "uncertain"].includes(job.status))
        return { dispatch: false, job };
      if (job && job.expires < now) throw new Fault("approval_expired", 410);
      if (!job) {
        if (this.jobs().length >= 1000)
          throw new Fault("request_capacity_reached", 429);
        job = {
          id: input.requestId,
          digest: hash,
          status: this.policy().approvalRequired ? "pending" : "approved",
          created: now,
          expires: now + 15 * 60000,
          reserve: RESERVATION,
        };
        this.put(key, job);
      }
      if (job.status === "pending") return { dispatch: false, job };
      const day = "usage:" + new Date(now).toISOString().slice(0, 10),
        used = this.get<number>(day) ?? 0;
      if (used + job.reserve > this.policy().dailyMicros)
        throw new Fault("daily_budget_exceeded", 429);
      if (this.env.LIVE_PROVIDER === "enabled" && !this.get("key"))
        throw new Fault("provider_key_required", 409);
      this.put(day, used + job.reserve);
      job.status = "running";
      this.put(key, job);
      return { dispatch: true, job };
    });
    await this.scheduleCleanup();
    if (!action.dispatch) return this.publicJob(action.job);
    try {
      const saved = this.get<{ encrypted: string }>("key");
      const keyValue = saved
        ? await unseal(saved.encrypted, tenant, this.env)
        : undefined;
      const audio = await synthesize(input, keyValue, this.env);
      const artifact = crypto.randomUUID(),
        audioExpires = Date.now() + this.policy().retentionHours * 3600000;
      action.job = { ...action.job, artifact, audioExpires };
      this.put(key, action.job);
      await this.scheduleCleanup();
      // R2 contains no user content in keys or metadata. The tenant hash partitions access.
      await this.env.AUDIO.put(tenant + "/" + artifact, audio.bytes, {
        httpMetadata: { contentType: audio.contentType },
        customMetadata: { expires: String(audioExpires) },
      });
      const job = {
        ...action.job,
        status: "complete" as const,
        artifact,
        audioExpires,
      };
      this.put(key, job);
      await this.scheduleCleanup();
      return this.publicJob(job);
    } catch {
      // Unknown outcomes stay charged against the reservation and are never dispatched again.
      const job = { ...action.job, status: "uncertain" as const };
      this.put(key, job);
      return this.publicJob(job);
    }
  }
  private publicJob(job: Job) {
    return {
      requestId: job.id,
      status: job.status,
      reservedUsd: job.reserve / 1e6,
      ...(job.status === "pending"
        ? { approvalPath: "/dashboard", approvalExpires: job.expires }
        : {}),
      ...(job.artifact
        ? { audioPath: "/audio/" + job.artifact, expires: job.audioExpires }
        : {}),
      demo: this.env.LIVE_PROVIDER !== "enabled",
    };
  }
  async audio(tenant: string, id: string) {
    const job = this.jobs().find((j) => j.artifact === id);
    if (!job || !job.audioExpires || job.audioExpires <= Date.now())
      throw new Fault("audio_expired_or_not_found", 404);
    const object = await this.env.AUDIO.get(tenant + "/" + id);
    if (!object) throw new Fault("audio_expired_or_not_found", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          'attachment; filename="vocs-audio.' +
          (this.env.LIVE_PROVIDER === "enabled" ? "mp3" : "wav") +
          '"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  async deleteAudio(tenant: string, id: string) {
    const job = this.jobs().find((j) => j.artifact === id);
    if (!job) throw new Fault("not_found", 404);
    if (job.status === "running") throw new Fault("request_in_progress", 409);
    await this.env.AUDIO.delete(tenant + "/" + id);
    delete job.artifact;
    delete job.audioExpires;
    this.put("job:" + job.id, job);
    return { deleted: true };
  }
  private async scheduleCleanup() {
    const next = Date.now() + 3600000;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next)
      await this.ctx.storage.setAlarm(next);
  }
  async alarm() {
    // The tenant ID is saved once from server-trusted routing, never from MCP arguments.
    const tenant = this.get<string>("tenant");
    const now = Date.now();
    for (const job of this.jobs()) {
      if (
        job.artifact &&
        job.audioExpires &&
        job.audioExpires <= now &&
        tenant
      ) {
        await this.env.AUDIO.delete(tenant + "/" + job.artifact);
        delete job.artifact;
        delete job.audioExpires;
        this.put("job:" + job.id, job);
      }
      if (job.created < now - 30 * 86400000) this.remove("job:" + job.id);
    }
    for (const row of this.ctx.storage.sql
      .exec<{ key: string }>("SELECT key FROM kv WHERE key LIKE 'usage:%'")
      .toArray()) {
      if (
        row.key.slice(6) <
        new Date(now - 7 * 86400000).toISOString().slice(0, 10)
      )
        this.remove(row.key);
    }
    if (this.jobs().length) await this.scheduleCleanup();
  }
  async bindTenant(tenant: string) {
    const saved = this.get<string>("tenant");
    if (saved && saved !== tenant) throw new Fault("tenant_mismatch", 403);
    this.put("tenant", tenant);
  }
}
