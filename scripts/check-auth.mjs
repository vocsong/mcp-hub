import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import assert from "node:assert/strict";
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: "dist-auth/worker.js",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
  }),
);
try {
  const response = await mf.dispatchFetch("https://auth.example.test/account");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "Login is not enabled");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const page = await mf.dispatchFetch("https://auth.example.test/login");
  assert.equal(page.status, 503);
  assert.match(await page.text(), /not activated/);
  const asset = await mf.dispatchFetch(
    "https://auth.example.test/auth-assets/ui.js",
  );
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  console.log("Auth bundle runtime: disabled default and static UI verified");
} finally {
  await mf.dispose();
}
