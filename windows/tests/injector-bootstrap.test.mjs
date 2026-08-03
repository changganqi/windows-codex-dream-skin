import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { earlyPayloadFor } from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const injectorPath = path.resolve(here, "../scripts/injector.mjs");
const source = await fs.readFile(injectorPath, "utf8");

assert.doesNotMatch(
  source,
  /home\?\.firstElementChild\?\.firstElementChild\?\.firstElementChild/,
  "Renderer verification must not depend on Codex's private home-page nesting.",
);
assert.match(
  source,
  /classList\.contains\('dream-home-shell'\)/,
  "Renderer verification must use the stable home-shell state.",
);
assert.match(
  source,
  /result\.composer\.y \+ result\.composer\.height <= result\.viewport\.height/,
  "Renderer verification must reject a new-task composer pushed below the viewport.",
);

function createFixture({ search = "" } = {}) {
  const observers = [];
  const timers = new Map();
  let nextTimer = 1;
  const markers = { shell: false, sidebar: false };
  const shellClasses = new Set();
  const shell = {
    classList: {
      add(...values) { values.forEach((value) => shellClasses.add(value)); },
      remove(...values) { values.forEach((value) => shellClasses.delete(value)); },
      contains(value) { return shellClasses.has(value); },
    },
  };
  const context = {
    window: { installs: [] },
    location: { protocol: "app:", search },
    document: {
      documentElement: {},
      body: {},
      querySelector(selector) {
        if (selector === "main") return markers.shell ? shell : null;
        if (selector === "aside.app-shell-left-panel") return markers.sidebar ? {} : null;
        return null;
      },
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.connected = true;
        observers.push(this);
      }
      observe() {}
      disconnect() { this.connected = false; }
    },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  return { context, markers, observers, shellClasses };
}

const guarded = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("guarded")', "guarded"), guarded.context);
assert.deepEqual(guarded.context.window.installs, [], "Auxiliary app targets must remain untouched.");
guarded.markers.shell = true;
guarded.observers[0].callback([]);
assert.deepEqual(
  guarded.context.window.installs,
  ["guarded"],
  "A collapsed sidebar must not prevent installation on the primary Codex surface.",
);
assert.equal(guarded.shellClasses.has("dream-main-surface"), true,
  "Early injection must establish the plugin-owned main-surface contract.");

const auxiliary = createFixture({ search: "?initialRoute=%2Favatar-overlay" });
auxiliary.markers.shell = true;
vm.runInNewContext(earlyPayloadFor('window.installs.push("auxiliary")', "auxiliary"), auxiliary.context);
assert.deepEqual(auxiliary.context.window.installs, [],
  "Auxiliary initialRoute windows must remain untouched even when they expose a main surface.");

const generations = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("old")', "old"), generations.context);
vm.runInNewContext(earlyPayloadFor('window.installs.push("new")', "new"), generations.context);
generations.markers.shell = true;
for (const observer of generations.observers) observer.callback([]);
assert.deepEqual(
  generations.context.window.installs,
  ["new"],
  "A stale early script must yield to the newest watcher generation.",
);
assert.equal(generations.context.window.__CODEX_DREAM_SKIN_EARLY_APPLIED__, "new");

const registrationStart = source.indexOf("earlyScriptId = await registerEarlyPayload");
const evaluateStart = source.indexOf("await session.evaluate(earlyPayloadFor", registrationStart);
const probeStart = source.indexOf("const probe = await waitForCodexProbe", registrationStart);
assert.ok(registrationStart >= 0 && evaluateStart > registrationStart && probeStart > evaluateStart,
  "New targets must register and run the early payload before full shell probing.");
assert.match(source, /if \(earlyInjectionFallback\) attachLoadFallback\(/,
  "Load-event reinjection must be attached only when early injection falls back.");
assert.match(source, /if \(!fallbackTargets\.get\(id\)\) return;/,
  "Fallback listeners must stay inert after a successful early registration.");
assert.match(source, /Page\.removeScriptToEvaluateOnNewDocument/,
  "Watcher shutdown and theme refresh must unregister persistent Page scripts.");
assert.doesNotMatch(source, /markers\.shell && markers\.sidebar/,
  "Primary renderer discovery must not require the optional sidebar DOM.");

console.log("PASS: Windows early injection is shell-guarded, generation-safe, ordered before probing, and fallback-scoped.");
