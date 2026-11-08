import { Miniflare, convertV4MiniflareOptions } from "miniflare";
export const mf = new Miniflare(
  convertV4MiniflareOptions({
    scriptPath: "dist/index.js",
    modules: true,
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
    host: "127.0.0.1",
    port: 8787,
    bindings: {
      APP_MODE: "local",
      PUBLIC_ORIGIN: "http://localhost:8787",
      LIVE_PROVIDER: "disabled",
    },
    durableObjects: { TENANTS: { className: "Tenant", useSQLite: true } },
    r2Buckets: ["AUDIO"],
    durableObjectsPersist: ".wrangler/local-demo/do",
    r2Persist: ".wrangler/local-demo/r2",
  }),
);
await mf.ready;
console.log("Local demo at http://localhost:8787/dashboard (no paid calls).");
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await mf.dispose();
    process.exit(0);
  });
