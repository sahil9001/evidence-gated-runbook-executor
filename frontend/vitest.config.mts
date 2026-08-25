import { defineConfig } from "vitest/config";

// Pure-logic tests (e.g. the api client) run over a mocked global `fetch`
// and stay on the Node environment (the default below). Component tests
// need a DOM; those files opt in individually with a
// `// @vitest-environment jsdom` docblock instead of paying the jsdom cost
// for every test file.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"]
  }
});
