import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// `wrangler types` regenerates worker-configuration.d.ts from wrangler.jsonc,
// which has no knowledge of the test-only TEST_MIGRATIONS binding wired up in
// vitest.config.ts. This file augments the ambient Cloudflare.Env consumed by
// `env` from `cloudflare:test` so that binding type-checks without editing
// the generated file.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
