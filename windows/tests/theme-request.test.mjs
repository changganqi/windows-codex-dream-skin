import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteSavedTheme, deleteTheme, strictThemeRequest } from "../scripts/injector.mjs";

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
