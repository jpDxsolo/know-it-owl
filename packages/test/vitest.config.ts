import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The tree under packages/test mirrors the source tree it covers:
    // packages/<pkg>/src/... is tested by packages/test/<pkg>/src/...
    include: ["**/*.test.ts"],
  },
});
