import { it, expect } from "vitest";
import preview from "../src/preview";
import { PREVIEW_VERSION, previewScript } from "../src/preview-assets";
it("public preview exposes no mutation APIs or MCP backend", () => {
  for (const path of ["/api/key", "/api/speech", "/openrouter", "/"]) {
    const r = preview.fetch(
      new Request("https://mcp.vocs.io" + path, {
        method: "POST",
        body: "not-a-secret",
      }),
    );
    expect(r.status).toBe(405);
  }
  expect(
    preview.fetch(new Request("https://mcp.vocs.io/openrouter")).status,
  ).toBe(503);
  expect(
    preview.fetch(new Request("https://mcp.vocs.io/api/status")).status,
  ).toBe(404);
});
it("preview identifies version and lack of server storage/live providers", async () => {
  const r = preview.fetch(new Request("https://mcp.vocs.io/health"));
  expect(await r.json()).toEqual({
    status: "ok",
    mode: "browser-only-mock",
    version: PREVIEW_VERSION,
    liveProvider: false,
    serverStorage: false,
  });
});
it("public HTML never offers a key input and clearly labels mock content", async () => {
  const html = await preview.fetch(new Request("https://mcp.vocs.io/")).text();
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('id="consent"');
  expect(html).toContain("Public mock preview");
  expect(html).toContain("No sign-in, real keys, API calls or charges");
  expect(html).toContain("Not");
});
it("browser script cannot send requests or persist user data", () => {
  for (const pattern of [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /WebSocket/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
  ])
    expect(previewScript).not.toMatch(pattern);
});
it("static responses block external connections, framing and sniffing", () => {
  const r = preview.fetch(new Request("https://mcp.vocs.io/"));
  expect(r.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'none'",
  );
  expect(r.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(r.headers.get("X-Vocs-Preview-Version")).toBe(PREVIEW_VERSION);
  expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
it("HEAD and unknown paths are safe", async () => {
  expect(
    await preview
      .fetch(new Request("https://mcp.vocs.io/", { method: "HEAD" }))
      .text(),
  ).toBe("");
  expect(
    preview.fetch(new Request("https://mcp.vocs.io/audio/anything")).status,
  ).toBe(404);
});
