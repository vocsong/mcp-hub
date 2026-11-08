// Atomic fixed-window counters. Store keyed digests, not client IPs or request paths.
export function privateRateLimit(db: D1Database, secret: string) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const encoder = new TextEncoder();
      const signingKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        signingKey,
        encoder.encode(`vocs-auth-rate-v1\0${key}`),
      );
      const bucket = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const now = Date.now();
      const row = await db
        .prepare(
          `INSERT INTO hub_rate_limit(bucket, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET
        count = CASE WHEN expires_at <= ? THEN 1 ELSE MIN(count + 1, ?) END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
      RETURNING count, expires_at`,
        )
        .bind(bucket, now + rule.window * 1000, now, rule.max + 1, now)
        .first<{ count: number; expires_at: number }>();
      if (!row) throw new Error("Rate limit unavailable");
      return {
        allowed: row.count <= rule.max,
        retryAfter:
          row.count <= rule.max
            ? null
            : Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
      };
    },
  };
}
