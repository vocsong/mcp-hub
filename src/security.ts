import { createRemoteJWKSet, jwtVerify } from "jose";
import { Fault, type Env, type Identity } from "./types";
export async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function identity(req: Request, env: Env): Promise<Identity> {
  const url = new URL(req.url);
  if (url.origin !== env.PUBLIC_ORIGIN) throw new Fault("invalid_host", 403);
  const origin = req.headers.get("origin");
  if (origin && origin !== env.PUBLIC_ORIGIN)
    throw new Fault("invalid_origin", 403);
  if (
    env.APP_MODE === "local" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    // A deliberately local-only demo principal; no credentials or live calls allowed.
    return {
      tenant: await digest("local-demo"),
      scopes: ["speech:write", "audio:read", "models:read"],
      dashboard: !url.pathname.startsWith("/openrouter"),
    };
  }
  if (
    env.APP_MODE !== "production" ||
    !env.AUTH_ISSUER ||
    !env.AUTH_AUDIENCE ||
    !env.AUTH_JWKS_URL ||
    !env.INVITED_SUBJECTS
  )
    throw new Fault("not_configured", 503);
  if (!env.AUTH_JWKS_URL.startsWith("https://"))
    throw new Fault("not_configured", 503);
  const token =
    req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1] ||
    req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Fault("authentication_required", 401);
  try {
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(env.AUTH_JWKS_URL)),
      {
        issuer: env.AUTH_ISSUER,
        audience: env.AUTH_AUDIENCE,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat"],
      },
    );
    if (!payload.sub || !env.INVITED_SUBJECTS.split(",").includes(payload.sub))
      throw Error();
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    return {
      tenant: await digest(env.AUTH_ISSUER + "\0" + payload.sub),
      scopes,
      dashboard: scopes.includes("dashboard:manage"),
    };
  } catch {
    throw new Fault("invalid_identity", 401);
  }
}
export async function boundedBody(
  req: Request,
  max = 16384,
): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Fault("body_too_large", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
async function encryptionKey(env: Env) {
  if (!env.KEY_ENCRYPTION_KEY)
    throw new Fault("encryption_not_configured", 503);
  const bytes = Uint8Array.from(atob(env.KEY_ENCRYPTION_KEY), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.length !== 32) throw new Fault("encryption_not_configured", 503);
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(value: string, tenant: string, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("v1:openrouter:" + tenant),
    },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return JSON.stringify({
    v: 1,
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(data)),
  });
}
export async function unseal(value: string, tenant: string, env: Env) {
  const x = JSON.parse(value);
  if (x.v !== 1) throw new Fault("key_version_unsupported", 503);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(x.iv),
        additionalData: new TextEncoder().encode("v1:openrouter:" + tenant),
      },
      await encryptionKey(env),
      new Uint8Array(x.data),
    ),
  );
}

export async function requestDigest(text: string, tenant: string, env: Env) {
  const secret =
    env.APP_MODE === "local"
      ? "local-demo-only-not-for-live-use"
      : env.KEY_ENCRYPTION_KEY;
  if (!secret) throw new Fault("encryption_not_configured", 503);
  const root = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(tenant),
      info: new TextEncoder().encode("vocs-request-hmac-v1"),
    },
    root,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
