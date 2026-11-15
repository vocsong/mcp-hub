// Public, anonymous boundary checks only. Never accepts credentials or target overrides.
// Run after a production preview deploy: `npm run check:native:production`. Without
// --enabled it checks the rolled-back state (catalog paths are the mock 404 again).
import assert from "node:assert/strict";
const hub = "https://mcp.vocs.io";
const issuer = "https://auth.vocs.io/api/auth";
const metadataPath = "/.well-known/oauth-protected-resource/api/connections";
const expectedEnabled = process.argv.includes("--enabled");
async function get(path, init = {}) {
  const response = await fetch(hub + path, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  }).catch((error) => {
    throw new Error(`${path}: ${error.name}`, { cause: error });
  });
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
    `${path}: HTTP ${response.status} cache policy`,
  );
  return response;
}
// The catalog responses carry HSTS like staging; the static mock never did.
const catalog = async (path, init) => {
  const response = await get(path, init);
  assert.equal(
    !!response.headers.get("strict-transport-security"),
    expectedEnabled,
    `${path}: HSTS`,
  );
  return response;
};
const health = await (await get("/health")).json();
assert.equal(typeof health.version, "string");
assert.deepEqual(
  { ...health, version: undefined },
  {
    status: "ok",
    mode: "browser-only-mock",
    version: undefined,
    liveProvider: false,
    serverStorage: true,
    productLogin: "identity-only",
    mcpAuthorized: false,
  },
);
const metadata = await catalog(metadataPath);
assert.equal(metadata.status, expectedEnabled ? 200 : 404);
assert.deepEqual(
  await metadata.json(),
  expectedEnabled
    ? {
        resource: hub + "/api/connections",
        authorization_servers: [issuer],
        scopes_supported: ["catalog:read"],
        bearer_methods_supported: ["header"],
      }
    : { error: "not_found" },
);
const anonymous = await catalog("/api/connections");
assert.equal(anonymous.status, expectedEnabled ? 401 : 404);
if (expectedEnabled)
  assert.equal(
    anonymous.headers.get("www-authenticate"),
    `Bearer realm="vocs-catalog", error="invalid_token", resource_metadata="${hub}${metadataPath}"`,
  );
// A non-JWT bearer is rejected locally, before any issuer call.
const malformed = await catalog("/api/connections", {
  headers: { Authorization: "Bearer invalid" },
});
assert.equal(malformed.status, expectedEnabled ? 401 : 404);
assert.equal(
  (
    await catalog("/api/connections", {
      headers: { Origin: "https://example.invalid" },
    })
  ).status,
  expectedEnabled ? 403 : 404,
);
// Everything else stays the static mock: no keys, audio, speech or MCP backend.
for (const path of ["/api/keys", "/api/audio", "/speech"])
  assert.equal((await get(path)).status, 404, path);
assert.equal((await get("/openrouter")).status, 503);
console.log(
  `PASS: anonymous production boundaries; native catalog ${expectedEnabled ? "enabled" : "disabled"}; no authenticated, paid, desktop or staging calls made.`,
);
