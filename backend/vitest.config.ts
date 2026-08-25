import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations")
        }
      }
    })
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/domain/**"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
});
