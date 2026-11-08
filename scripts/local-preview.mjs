import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const mf = new Miniflare(
  convertV4MiniflareOptions({
    scriptPath: "dist-preview/preview.js",
    modules: true,
    compatibilityDate: "2026-11-08",
    host: "127.0.0.1",
    port: 8788,
  }),
);
await mf.ready;
console.log("Browser-only mock preview: http://localhost:8788");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
