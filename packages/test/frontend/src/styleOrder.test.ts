import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The theme has to be imported before the app.
 *
 * Vite emits stylesheets in module-graph order. With `App` imported first,
 * every screen's CSS landed *before* theme.css in the bundle — and since theme
 * rules and screen rules are mostly one class each, the tie went to whichever
 * came last. The theme won every time, and each override a screen made was
 * silently thrown away: `.kio-input{width:100%}` beat
 * `.kio-marking__points{width:5rem}`, so the marking sheet's points boxes
 * overflowed their row on a live deployment.
 *
 * Nothing else catches this. Vitest does not process CSS, so no component test
 * can see a stylesheet at all, and the rules were all present in the bundle —
 * only their order was wrong. This asserts the one line that decides it.
 */
describe("stylesheet order", () => {
  it("imports the theme before the app that overrides it", () => {
    // Resolved from the vitest root (packages/test), because these suites run
    // in jsdom where `import.meta.url` is not a file: URL.
    const main = readFileSync(resolve(process.cwd(), "../frontend/src/main.tsx"), "utf8");
    const theme = main.indexOf('import "./styles/theme.css"');
    const app = main.indexOf('import { App }');

    expect(theme).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(app);
  });
});
