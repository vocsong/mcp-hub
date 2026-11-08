import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const mf = new Miniflare(
  convertV4MiniflareOptions({
    scriptPath: "dist-preview/preview-login.js",
    modules: true,
    compatibilityDate: "2026-11-08",
    host: "127.0.0.1",
    port: 0,
  }),
);
try {
  await mf.ready;
  const r = await mf.dispatchFetch("https://mcp.vocs.io/health");
  assert.equal(r.status, 200);
  const health = await r.json();
  assert.equal(health.mode, "browser-only-mock");
  assert.equal(health.liveProvider, false);
  assert.equal(health.serverStorage, false);
  assert.equal(
    (
      await mf.dispatchFetch("https://mcp.vocs.io/api/key", {
        method: "POST",
        body: "not-a-secret",
      })
    ).status,
    405,
  );
  console.log(
    "Preview runtime smoke passed: static Worker starts, mock-only health, POST rejected.",
  );
} finally {
  await mf.dispose();
}
