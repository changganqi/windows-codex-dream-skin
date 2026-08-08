import assert from "node:assert/strict";
import { rendererVerificationPass } from "../scripts/injector.mjs";

const codex26803Home = {
  installed: true,
  version: "1.4.3",
  expectedVersion: "1.4.3",
  stylePresent: true,
  chromePresent: true,
  chromePointerEvents: "none",
  shellPresent: true,
  homePresent: true,
  homeMarkerPresent: true,
  suggestionsPresent: false,
  cards: [],
  composer: null,
  viewport: { width: 1225, height: 731 },
};

assert.equal(rendererVerificationPass(codex26803Home), true,
  "Codex 26.803 must verify when the skin core is installed before optional home controls mount.");

for (const required of ["installed", "stylePresent", "chromePresent", "shellPresent"]) {
  assert.equal(rendererVerificationPass({ ...codex26803Home, [required]: false }), false,
    `Renderer verification must still require ${required}.`);
}
assert.equal(rendererVerificationPass({ ...codex26803Home, version: "stale" }), false,
  "Renderer verification must reject a stale injected version.");
assert.equal(rendererVerificationPass({ ...codex26803Home, chromePointerEvents: "auto" }), false,
  "Renderer verification must reject an input-blocking decorative chrome layer.");
assert.equal(rendererVerificationPass({ ...codex26803Home, viewport: { width: 0, height: 731 } }), false,
  "Renderer verification must reject a renderer without a sized viewport.");

const changedPrivateHome = {
  ...codex26803Home,
  homeMarkerPresent: false,
  suggestionsPresent: true,
  cards: [],
};
assert.equal(rendererVerificationPass(changedPrivateHome), true,
  "Private Codex home-card structure must remain diagnostic rather than a startup gate.");

console.log("PASS: renderer verification survives optional Codex 26.803 home DOM changes.");
