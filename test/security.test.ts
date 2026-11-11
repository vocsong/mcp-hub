import { env } from "cloudflare:test";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { identity, requestDigest } from "../src/security";
import { synthesize } from "../src/provider";
import type { Env } from "../src/types";
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("Unexpected network access");
  });
});
afterEach(() => vi.restoreAllMocks());
const e: Env = {
  ...(env as Env),
  APP_MODE: "production",
  PUBLIC_ORIGIN: "https://mcp.vocs.io",
  AUTH_ISSUER: "https://auth.example.test",
  AUTH_JWKS_URL: "https://auth.example.test/jwks",
  AUTH_AUDIENCE: "vocs-mcp",
  INVITED_SUBJECTS: "alice",
};
it("validates signed identity, issuer, audience, invitation and scopes", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  vi.mocked(fetch).mockImplementation(async (url) => {
    expect(String(url)).toBe("https://auth.example.test/jwks");
    return Response.json({ keys: [jwk] });
  });
  const token = async (aud: string, sub = "alice", iss = e.AUTH_ISSUER!) =>
    new SignJWT({ scope: "speech:write" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(iss)
      .setAudience(aud)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  const req = (t: string) =>
    new Request(e.PUBLIC_ORIGIN + "/openrouter", {
      headers: { Authorization: "Bearer " + t },
    });
  const good = await identity(req(await token("vocs-mcp")), e);
  expect(good.scopes).toEqual(["speech:write"]);
  expect(good.dashboard).toBe(false);
  await expect(identity(req(await token("wrong")), e)).rejects.toThrow(
    "invalid_identity",
  );
  await expect(
    identity(req(await token("vocs-mcp", "bob")), e),
  ).rejects.toThrow("invalid_identity");
  await expect(
    identity(req(await token("vocs-mcp", "alice", "https://evil.test")), e),
  ).rejects.toThrow("invalid_identity");
});
it("HMAC fingerprints are tenant-bound and not raw content hashes", async () => {
  expect(await requestDigest("hello", "alice", env as Env)).not.toBe(
    await requestDigest("hello", "bob", env as Env),
  );
});
it("live provider fails closed without a fresh price review", async () => {
  await expect(
    synthesize(
      {
        text: "hello",
        voice: "en_paul_neutral",
        requestId: crypto.randomUUID(),
      },
      "test-not-secret",
      { ...e, LIVE_PROVIDER: "enabled" },
    ),
  ).rejects.toThrow("price_review_required");
});
it("live speech uses only fixed endpoint, model and privacy controls, returning bounded raw audio", async () => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(init?.redirect).toBe("manual");
    expect(new Request(url, init).redirect).toBe("manual");
    const x = JSON.parse(init?.body as string);
    expect(x.model).toBe("mistralai/voxtral-mini-tts-2603");
    expect(x.provider).toEqual({ zdr: true, data_collection: "deny" });
    return new Response("audio", { headers: { "Content-Type": "audio/mpeg" } });
  });
  const audio = await synthesize(
    { text: "hello", voice: "en_paul_neutral", requestId: crypto.randomUUID() },
    "test-not-secret",
    {
      ...e,
      LIVE_PROVIDER: "enabled",
      PRICE_VERIFIED_UNTIL: new Date(Date.now() + 3600000).toISOString(),
    },
  );
  expect(new TextDecoder().decode(audio.bytes)).toBe("audio");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([301, 302, 303, 307, 308])(
  "rejects provider HTTP %i without forwarding the key or retrying",
  async (status) => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      expect(new Request(input, init).redirect).toBe("manual");
      return new Response(null, {
        status,
        headers: { Location: "https://untrusted.example/speech" },
      });
    });
    await expect(
      synthesize(
        {
          text: "synthetic fixture",
          voice: "en_paul_neutral",
          requestId: crypto.randomUUID(),
        },
        "test-not-secret",
        {
          ...e,
          LIVE_PROVIDER: "enabled",
          PRICE_VERIFIED_UNTIL: new Date(Date.now() + 3600000).toISOString(),
        },
      ),
    ).rejects.toThrow("provider_outcome_uncertain");
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
