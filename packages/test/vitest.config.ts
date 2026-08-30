import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The tree under packages/test mirrors the source tree it covers:
    // packages/<pkg>/src/... is tested by packages/test/<pkg>/src/...
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // Only the frontend needs a DOM (localStorage, WebSocket, React); giving
    // the node-side suites jsdom would just slow them down.
    environmentMatchGlobs: [["**/frontend/**", "jsdom"]],
    // Repairs the DOM `localStorage` that Node 25's own global breaks. The
    // setup file no-ops outside a DOM environment. See setup/domStorage.ts.
    setupFiles: ["./setup/domStorage.ts"],
  },
});
