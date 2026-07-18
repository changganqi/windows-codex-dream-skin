import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPet } from "./install-pet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");
const home = process.env.USERPROFILE || process.env.HOME;
if (!home) throw new Error("Unable to determine the current Windows user profile");

const result = await installPet({
  sourceRoot: path.join(repositoryRoot, "assets", "pets", "miku-future"),
  home,
});
console.log(JSON.stringify({
  installed: true,
  id: result.petId,
  targetRoot: result.targetRoot,
  selectedAvatar: result.effectivePetId,
}, null, 2));
