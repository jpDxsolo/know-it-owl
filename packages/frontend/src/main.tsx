import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
/*
 * The theme comes first, and the order is load-bearing — do not tidy it below
 * the App import.
 *
 * Vite emits stylesheets in module-graph order, so importing App first put
 * every screen's CSS *before* theme.css in the bundle. Theme rules and screen
 * rules are mostly a single class each, so the tie went to whichever came last
 * — the theme — and every override a screen made was silently discarded.
 * `.kio-input{width:100%}` beat `.kio-marking__points{width:5rem}`, and the
 * marking sheet's points boxes overflowed their row because of it.
 *
 * Imported first, the theme is what it was always meant to be: the base layer
 * a screen can override.
 */
import "./styles/theme.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
