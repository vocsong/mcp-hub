import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc", environment: "local" },
      miniflare: {
        d1Databases: ["AUTH_DB"],
        bindings: {
          KEY_ENCRYPTION_KEY: btoa("01234567890123456789012345678901"),
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
