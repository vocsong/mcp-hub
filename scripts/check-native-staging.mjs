// Public, anonymous boundary checks only. Never accepts credentials or target overrides.
import assert from "node:assert/strict";
const hub = "https://vocs-mcp-staging.vocs.workers.dev";
const issuer = "https://vocs-login-staging.vocs.workers.dev/api/auth";
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
  assert.ok(response.headers.get("strict-transport-security"));
  return response;
}
const health = await (await get("/health")).json();
assert.deepEqual(health, {
  mode: "models-only",
  liveProvider: false,
  audio: false,
});
const metadata = await get(
  "/.well-known/oauth-protected-resource/api/connections",
);
assert.equal(metadata.status, expectedEnabled ? 200 : 503);
if (expectedEnabled) {
  assert.deepEqual(await metadata.json(), {
    resource: hub + "/api/connections",
    authorization_servers: [issuer],
    scopes_supported: ["catalog:read"],
    bearer_methods_supported: ["header"],
  });
}
const anonymous = await get("/api/connections");
assert.equal(anonymous.status, 401);
const malformed = await get("/api/connections", {
  headers: { Authorization: "Bearer invalid" },
});
assert.equal(malformed.status, expectedEnabled ? 401 : 503);
assert.equal(
  (
    await get("/api/connections", {
      headers: { Origin: "https://example.invalid" },
    })
  ).status,
  403,
);
for (const path of ["/api/keys", "/api/audio", "/speech"])
  assert.equal((await get(path)).status, 403);
console.log(
  `PASS: anonymous staging boundaries; native catalog ${expectedEnabled ? "enabled" : "disabled"}; no authenticated, paid, desktop or production calls made.`,
);
