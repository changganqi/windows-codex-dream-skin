import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPet } from "../scripts/install-pet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");
const home = await fs.mkdtemp(path.join(os.tmpdir(), "fei-miku-pet-test-"));
const sourceRoot = path.join(windowsRoot, "assets", "pets", "miku-future");
const result = await installPet({ sourceRoot, home });
assert.equal(result.petId, "miku-future");
assert.equal(result.effectivePetId, "custom:miku-future");
assert.equal(await fs.stat(path.join(home, ".codex", "pets", "miku-future", "spritesheet.webp")).then(() => true), true);
assert.match(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8"), /selected-avatar-id = "custom:miku-future"/);

console.log("PASS: Miku Future installs independently and selects only the Codex avatar config.");
