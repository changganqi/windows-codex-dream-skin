import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCustomTheme,
  deleteSavedTheme,
  deleteTheme,
  setSavedThemePolaroid,
  setSavedThemePreview,
  strictThemeRequest,
  upgradeSavedTheme,
} from "../scripts/injector.mjs";

const windowsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const valid = {
  schemaVersion: 1,
  requestId: "1710000000000-ab12",
  kind: "select-theme",
  themeId: "miku-488137",
};
assert.deepEqual(strictThemeRequest(valid), valid);

for (const invalid of [
  { ...valid, themeId: "../../outside" },
  { ...valid, extra: true },
  { ...valid, kind: "unknown" },
  { ...valid, requestId: "contains spaces" },
]) {
  assert.throws(() => strictThemeRequest(invalid), /invalid|unsupported|Unknown|Unsupported/);
}

const custom = {
  schemaVersion: 1,
  requestId: "1710000000000-custom",
  kind: "custom-image",
  name: "我的 Miku 背景",
  inheritThemeId: "miku-488137",
  imageDataUrl: "data:image/webp;base64,UklGRg==",
};
assert.deepEqual(strictThemeRequest(custom), custom);
assert.throws(() => strictThemeRequest({ ...custom, name: "" }), /invalid fields/);

const analyzedCustom = {
  schemaVersion: 1,
  requestId: "1710000000000-analyzed",
  kind: "custom-image",
  name: "自动配色主题",
  imageDataUrl: "data:image/webp;base64,UklGRg==",
  previewDataUrl: "data:image/webp;base64,UklGRg==",
  appearance: "dark",
  art: { focusX: 0.62, focusY: 0.44, safeArea: "left", taskMode: "auto" },
  palette: { accent: "#22b8c7", secondary: "#ef71b8", surface: "#111820", text: "#eff9fa" },
};
assert.deepEqual(strictThemeRequest(analyzedCustom), analyzedCustom);
assert.throws(
  () => strictThemeRequest({ ...analyzedCustom, palette: { ...analyzedCustom.palette, accent: "red" } }),
  /analyzed fields/,
);

const previewRequest = {
  schemaVersion: 1,
  requestId: "1710000000000-preview",
  kind: "set-theme-preview",
  themeId: "custom-existing",
  previewDataUrl: "data:image/webp;base64,UklGRg==",
};
assert.deepEqual(strictThemeRequest(previewRequest), previewRequest);
const upgradeRequest = {
  schemaVersion: 1,
  requestId: "1710000000000-upgrade",
  kind: "upgrade-saved-theme",
  themeId: "custom-existing",
  previewDataUrl: analyzedCustom.previewDataUrl,
  appearance: analyzedCustom.appearance,
  art: analyzedCustom.art,
  palette: analyzedCustom.palette,
};
assert.deepEqual(strictThemeRequest(upgradeRequest), upgradeRequest);
const polaroidRequest = {
  schemaVersion: 1,
  requestId: "1710000000000-theme-polaroid",
  kind: "set-theme-polaroid",
  themeId: "custom-existing",
  imageDataUrl: "data:image/webp;base64,UklGRg==",
};
assert.deepEqual(strictThemeRequest(polaroidRequest), polaroidRequest);

const native = {
  schemaVersion: 1,
  requestId: "1710000000000-native",
  kind: "native-mode",
};
assert.deepEqual(strictThemeRequest(native), native);
assert.throws(() => strictThemeRequest({ ...native, themeId: "miku-488137" }), /invalid fields/);

const polaroidVisibility = {
  schemaVersion: 1,
  requestId: "1710000000000-polaroid",
  kind: "set-polaroid-visibility",
  visible: false,
};
assert.deepEqual(strictThemeRequest(polaroidVisibility), polaroidVisibility);
assert.throws(() => strictThemeRequest({ ...polaroidVisibility, visible: "false" }), /invalid fields/);
assert.throws(() => strictThemeRequest({ ...polaroidVisibility, extra: true }), /invalid fields/);

const deletion = {
  schemaVersion: 1,
  requestId: "1710000000000-delete",
  kind: "delete-theme",
  themeId: "custom-upload",
};
assert.deepEqual(strictThemeRequest(deletion), deletion);
assert.throws(() => strictThemeRequest({ ...deletion, themeId: "../../outside" }), /invalid fields/);
assert.throws(() => strictThemeRequest({ ...deletion, themeId: "codex-native" }), /invalid fields/);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-delete-"));
try {
  const themeDir = path.join(temporaryRoot, "active");
  const savedRoot = path.join(temporaryRoot, "themes");
  const savedThemeDir = path.join(savedRoot, "custom-one");
  const outsideThemeDir = path.join(temporaryRoot, "outside");
  await fs.mkdir(themeDir, { recursive: true });
  await fs.mkdir(savedThemeDir, { recursive: true });
  await fs.mkdir(outsideThemeDir, { recursive: true });
  await fs.writeFile(path.join(savedThemeDir, "theme.json"), "{}\n");
  await fs.writeFile(path.join(outsideThemeDir, "theme.json"), "{}\n");

  const sourceImage = await fs.readFile(path.join(windowsRoot, "assets", "presets", "miku-488137", "polaroid.webp"));
  const sourceDataUrl = `data:image/webp;base64,${sourceImage.toString("base64")}`;
  const firstCustom = await createCustomTheme(themeDir, {
    ...analyzedCustom,
    imageDataUrl: sourceDataUrl,
    previewDataUrl: sourceDataUrl,
  });
  const secondCustom = await createCustomTheme(themeDir, {
    ...analyzedCustom,
    name: "第二个独立主题",
    imageDataUrl: sourceDataUrl,
    previewDataUrl: sourceDataUrl,
  });
  assert.notEqual(firstCustom.theme.id, secondCustom.theme.id);
  assert.notEqual(path.dirname(firstCustom.themePath), path.dirname(secondCustom.themePath));
  assert.deepEqual(firstCustom.theme.branding, {}, "new custom themes must not inherit another theme's logo or polaroid");
  assert.equal(firstCustom.theme.appearance, "dark");
  assert.equal(firstCustom.theme.palette.accent, analyzedCustom.palette.accent);
  assert.ok(firstCustom.previewAsset?.bytes.length > 0, "custom theme preview must be persisted beside its artwork");
  const firstCatalog = { entries: new Map([[firstCustom.theme.id, { ...firstCustom, source: "saved" }]]) };
  await setSavedThemePreview(themeDir, firstCustom.theme.id, sourceDataUrl, firstCatalog);
  await upgradeSavedTheme(themeDir, {
    ...upgradeRequest,
    themeId: firstCustom.theme.id,
    previewDataUrl: sourceDataUrl,
  }, firstCatalog);
  await setSavedThemePolaroid(themeDir, firstCustom.theme.id, sourceDataUrl, firstCatalog);
  const updatedManifest = JSON.parse(await fs.readFile(firstCustom.themePath, "utf8"));
  assert.equal(updatedManifest.preview, "preview.webp");
  assert.equal(updatedManifest.branding.polaroid, "polaroid.webp");
  assert.ok((await fs.stat(path.join(path.dirname(firstCustom.themePath), "polaroid.webp"))).isFile());

  const savedCatalog = {
    entries: new Map([["custom-one", {
      source: "saved",
      themePath: path.join(savedThemeDir, "theme.json"),
    }]]),
  };
  await deleteSavedTheme(themeDir, "custom-one", savedCatalog);
  await assert.rejects(fs.stat(savedThemeDir), /ENOENT/);

  const escapedCatalog = {
    entries: new Map([["outside-theme", {
      source: "saved",
      themePath: path.join(outsideThemeDir, "theme.json"),
    }]]),
  };
  await assert.rejects(
    deleteSavedTheme(themeDir, "outside-theme", escapedCatalog),
    /escaped the managed saved-theme directory/,
  );
  const builtInCatalog = {
    entries: new Map([["miku-488137", { source: "built-in", themePath: "ignored" }]]),
  };
  await assert.rejects(
    deleteSavedTheme(themeDir, "miku-488137", builtInCatalog),
    /Only themes in My Themes/,
  );

  const hideableCatalog = {
    entries: new Map([
      ["genshin-night", { source: "built-in", theme: { id: "genshin-night" }, themePath: "managed-by-engine" }],
      ["miku-488137", { source: "built-in", theme: { id: "miku-488137" }, themePath: "managed-by-engine" }],
    ]),
  };
  const hidden = await deleteTheme(themeDir, "genshin-night", hideableCatalog);
  assert.equal(hidden.mode, "hidden");
  const hiddenState = JSON.parse(await fs.readFile(path.join(temporaryRoot, "hidden-themes.json"), "utf8"));
  assert.deepEqual(hiddenState.themeIds, ["genshin-night"]);
  await assert.rejects(
    deleteTheme(themeDir, "miku-488137", {
      entries: new Map([["miku-488137", hideableCatalog.entries.get("miku-488137")]]),
    }),
    /final available theme/,
  );
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log("PASS: watcher theme requests, saved-theme deletion and built-in hiding use strict managed state.");
