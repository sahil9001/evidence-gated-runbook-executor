import { defineConfig } from "vitest/config";

// This slice's frontend tests are pure logic over a mocked global `fetch`,
// so the Node environment is sufficient — no jsdom/React Testing Library
// dependency is added until a test genuinely needs a DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
