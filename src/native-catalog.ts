/** Native catalog resource authorization. No browser cookies or MCP resource
 * tokens are accepted as substitutes. Disabled until the issuer and confidential
 * introspection client are provisioned and independently verified.
 */
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { selectLoginProfile, type LoginProfileEnv } from "./login/profile";
import { Fault } from "./types";
export interface NativeCatalogEnv extends LoginProfileEnv {
  NATIVE_CATALOG_ENABLED?: string;
  NATIVE_CATALOG_CLIENT_SECRET?: string;
}
async function boundedResponse(
  response: Response,
  max: number,
): Promise<Response> {
  const reader = response.body?.getReader();
  if (!reader) throw new Fault("identity_service_unavailable", 503);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Fault("identity_service_unavailable", 503);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, response);
}
export async function readNativeCatalogPrincipal(
  request: Request,
  env: NativeCatalogEnv,
): Promise<{ issuer: string; subject: string }> {
  const profile = selectLoginProfile(env);
  if (
    !profile ||
    env.NATIVE_CATALOG_ENABLED !== "true" ||
    !env.NATIVE_CATALOG_CLIENT_SECRET
  )
    throw new Fault("native_catalog_not_enabled", 503);
  const resource = profile.origin + "/api/connections";
  if (request.url !== resource || request.method !== "GET")
    throw new Fault("invalid_request");
  if (
    request.headers.has("Cookie") ||
    request.headers.has("Cf-Access-Jwt-Assertion")
  )
    throw new Fault("invalid_identity", 401);
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9._~-]{1,8192})$/)?.[1];
  if (!token) throw new Fault("invalid_identity", 401);
  const issuer = profile.issuer + "/api/auth";
  const jwksUrl = issuer + "/jwks";
  const introspectUrl = issuer + "/oauth2/introspect";
  // One bounded timeout for keys + verification + fresh introspection. No cached
  // allow result: every resource request observes source-session revocation.
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(abort, 5000);
  try {
    const keys = createRemoteJWKSet(new URL(jwksUrl), {
      [customFetch]: async (url, options) => {
        if (String(url) !== jwksUrl) throw new Fault("invalid_identity", 401);
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          redirect: "manual",
        });
        if (response.status !== 200)
          throw new Fault("identity_service_unavailable", 503);
        return boundedResponse(response, 65536);
      },
    });
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer,
      audience: resource,
      algorithms: ["ES256"],
      requiredClaims: ["sub", "iat", "exp", "sid", "azp", "scope"],
    });
    const now = Date.now() / 1000;
    if (
      protectedHeader.typ !== "at+jwt" ||
      payload.cnf !== undefined ||
      payload.aud !== resource ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 256 ||
      typeof payload.sid !== "string" ||
      !payload.sid ||
      payload.sid.length > 256 ||
      payload.azp !== "vocs-code" ||
      payload.scope !== "catalog:read" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.iat > now + 5 ||
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 300
    )
      throw new Fault("invalid_identity", 401);
    const response = await fetch(introspectUrl, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        token,
        token_type_hint: "access_token",
        client_id:
          profile.name === "staging"
            ? "mcp-hub-catalog-staging"
            : "mcp-hub-catalog",
        client_secret: env.NATIVE_CATALOG_CLIENT_SECRET,
      }),
    });
    if (response.status !== 200)
      throw new Fault("identity_service_unavailable", 503);
    const value: unknown = await (
      await boundedResponse(response, 16384)
    ).json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Fault("invalid_identity", 401);
    const claims = value as Record<string, unknown>;
    if (
      claims.active !== true ||
      claims.cnf !== undefined ||
      typeof claims.token_type !== "string" ||
      claims.token_type.toLowerCase() !== "bearer" ||
      claims.iss !== issuer ||
      claims.sub !== payload.sub ||
      claims.aud !== resource ||
      claims.scope !== "catalog:read" ||
      claims.azp !== "vocs-code" ||
      claims.client_id !== "vocs-code" ||
      claims.sid !== payload.sid ||
      claims.exp !== payload.exp ||
      claims.iat !== payload.iat ||
      controller.signal.aborted
    )
      throw new Fault("invalid_identity", 401);
    return { issuer: profile.issuer, subject: payload.sub };
  } catch (error) {
    if (error instanceof Fault) throw error;
    // Errors must never include an upstream body, JWT, token or client secret.
    throw new Fault(
      controller.signal.aborted
        ? "identity_service_unavailable"
        : "invalid_identity",
      controller.signal.aborted ? 503 : 401,
    );
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}
