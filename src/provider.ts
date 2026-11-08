import { boundedBody } from "./security";
import { Fault, MODEL, type Env, type Speech } from "./types";
export async function synthesize(
  input: Speech,
  key: string | undefined,
  env: Env,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (env.LIVE_PROVIDER !== "enabled") {
    // One second of a soft 440 Hz tone: clearly a transport demo, not synthesized speech.
    const rate = 8000,
      data = new Uint8Array(44 + rate * 2),
      v = new DataView(data.buffer);
    const str = (s: string, o: number) =>
      [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str("RIFF", 0);
    v.setUint32(4, data.length - 8, true);
    str("WAVEfmt ", 8);
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str("data", 36);
    v.setUint32(40, rate * 2, true);
    for (let i = 0; i < rate; i++)
      v.setInt16(
        44 + i * 2,
        Math.sin((i * 2 * Math.PI * 440) / rate) * 1800,
        true,
      );
    return { bytes: data, contentType: "audio/wav" };
  }
  if (env.APP_MODE !== "production" || !key)
    throw new Fault("live_provider_disabled", 503);
  const validUntil = Date.parse(env.PRICE_VERIFIED_UNTIL || "");
  if (
    !Number.isFinite(validUntil) ||
    validUntil < Date.now() ||
    validUntil > Date.now() + 86400000
  )
    throw new Fault("price_review_required", 503);
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: input.text,
      voice: input.voice,
      response_format: "mp3",
      provider: { zdr: true, data_collection: "deny" },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Fault("provider_outcome_uncertain", 502);
  }
  const type = response.headers.get("Content-Type")?.split(";")[0];
  if (type !== "audio/mpeg" && type !== "audio/mp3") {
    await response.body?.cancel();
    throw new Fault("unexpected_provider_response", 502);
  }
  const bytes = await boundedBody(
    new Request("https://internal.invalid", {
      method: "POST",
      body: response.body,
      duplex: "half",
    } as RequestInit),
    8 * 1024 * 1024,
  );
  if (!bytes.length) throw new Fault("empty_provider_response", 502);
  return { bytes, contentType: "audio/mpeg" };
}
