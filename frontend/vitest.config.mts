import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pure-logic tests (e.g. the api client) run over a mocked global `fetch`
// and stay on the Node environment (the default below). Component tests
// need a DOM; those files opt in individually with a
// `// @vitest-environment jsdom` docblock instead of paying the jsdom cost
// for every test file.
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` -> `./src/*` path mapping in tsconfig.json, which
      // shadcn/ui components use for their imports.
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "*.test.ts"],
    setupFiles: ["./vitest.setup.ts"]
  }
});
