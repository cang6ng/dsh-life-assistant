/**
 * Entry: mount the App composition root into #root. All FluentProvider /
 * theme / store wiring lives in app.tsx.
 */

import { createRoot } from "react-dom/client";
import { App } from "./app";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html must contain <div id=\"root\"></div>");
}

createRoot(container).render(<App />);
