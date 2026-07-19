import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImageMetadata } from "./image-metadata.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const root = path.resolve(here, "..");
const SKIN_VERSION = "1.3.0";
const MAX_ART_BYTES = 16 * 1024 * 1024;
const MAX_BRANDING_BYTES = 4 * 1024 * 1024;
const MAX_CUSTOM_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_THEMES = 24;
const MAX_CATALOG_INLINE_BYTES = 4 * 1024 * 1024;
const MAX_CATALOG_BYTES = 12 * 1024 * 1024;
const STRONG_THEME_AUDIT_MS = 30000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const BROWSER_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const THEME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const THEME_SELECTION_SCHEMA = 1;
const HIDDEN_THEMES_SCHEMA = 1;
const UI_PREFERENCES_SCHEMA = 1;
const THEME_REQUEST_KEY = "__CODEX_DREAM_SKIN_THEME_REQUEST__";
const THEME_ACK_KEY = "__CODEX_DREAM_SKIN_THEME_ACK__";
const NATIVE_THEME_ID = "codex-native";

class CdpIdentityMismatchError extends Error {}

function parseArgs(argv) {
  const options = {
    port: 9335,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    browserId: null,
    themeDir: path.join(root, "assets"),
    pauseFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--browser-id") options.browserId = argv[++i];
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--pause-file") options.pauseFile = path.resolve(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--self-test") options.mode = "self-test";
    else if (arg === "--check-payload") options.mode = "check-payload";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.browserId !== null && !BROWSER_ID_PATTERN.test(options.browserId)) {
    throw new Error(`Invalid browser ID: ${options.browserId}`);
  }
  if (["watch", "once", "verify", "remove"].includes(options.mode) && !options.browserId) {
    throw new Error(`--browser-id is required in ${options.mode} mode`);
  }
  return options;
}

function validatedDebuggerUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  const pathIsValid = /^\/devtools\/(?:page|browser)\/[A-Za-z0-9._-]{1,200}$/.test(url.pathname);
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port ||
      url.username || url.password || url.search || url.hash || !pathIsValid) {
    throw new Error("Rejected a CDP WebSocket URL outside the allowed loopback endpoint shape");
  }
  return url.href;
}

function parseCdpMessage(data) {
  try {
    const message = JSON.parse(String(data));
    return message && typeof message === "object" ? message : null;
  } catch {
    return null;
  }
}

function browserIdFromVersion(version, port) {
  const url = validatedDebuggerUrl(version, port);
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/devtools\/browser\/([A-Za-z0-9._-]{1,200})$/);
  if (!match || parsed.search || parsed.hash || !BROWSER_ID_PATTERN.test(match[1])) {
    throw new Error("Rejected an invalid CDP browser identity URL");
  }
  return match[1];
}

function isValidCdpPageTarget(item, port) {
  if (item?.type !== "page" || !item.url?.startsWith("app://") || typeof item.id !== "string" ||
      !BROWSER_ID_PATTERN.test(item.id) || !item.webSocketDebuggerUrl) return false;
  try {
    const debuggerUrl = new URL(validatedDebuggerUrl(item, port));
    return debuggerUrl.pathname === `/devtools/page/${item.id}`;
  } catch {
    return false;
  }
}

class CdpSession {
  constructor(target, port) {
    this.target = target;
    this.ws = new WebSocket(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { this.ws.close(); } catch {}
        reject(new Error("CDP WebSocket open timed out"));
      }, 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP WebSocket open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("error", () => this.close());
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    const message = parseCdpMessage(event.data);
    if (!message) {
      this.close();
      return;
    }
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("CDP session closed"));
    }
    this.pending.clear();
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

class BrowserIdentityAnchor {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.closed = false;
    this.ws.addEventListener("close", () => { this.closed = true; });
    this.ws.addEventListener("error", () => {
      this.closed = true;
      try { this.ws.close(); } catch {}
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error("CDP browser identity WebSocket open timed out"));
      }, 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket open failed"));
      }, { once: true });
      this.ws.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket closed during startup"));
      }, { once: true });
    });
    if (this.closed) throw new Error("CDP browser identity WebSocket is already closed");
    return this;
  }

  close() {
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

async function fetchCdpJson(port, resource) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${resource}`, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function listAppTargets(port, expectedBrowserId = null) {
  const targets = await fetchCdpJson(port, "/json/list");
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array");
  if (expectedBrowserId) {
    const version = await fetchCdpJson(port, "/json/version");
    const actualBrowserId = browserIdFromVersion(version, port);
    if (actualBrowserId !== expectedBrowserId) {
      throw new CdpIdentityMismatchError(
        `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
      );
    }
  }
  return targets.filter((item) => isValidCdpPageTarget(item, port));
}

async function connectBrowserIdentityAnchor(port, expectedBrowserId) {
  const version = await fetchCdpJson(port, "/json/version");
  const actualBrowserId = browserIdFromVersion(version, port);
  if (actualBrowserId !== expectedBrowserId) {
    throw new CdpIdentityMismatchError(
      `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
    );
  }
  return new BrowserIdentityAnchor(validatedDebuggerUrl(version, port)).open();
}

const THEME_CHOICES = {
  appearance: new Set(["auto", "light", "dark"]),
  safeArea: new Set(["auto", "left", "right", "center", "none"]),
  taskMode: new Set(["auto", "ambient", "banner", "off"]),
};

function normalizedUnit(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${name} must be null or a number between 0 and 1`);
  }
  return number;
}

function normalizedChoice(value, name, choices, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!choices.has(value)) throw new Error(`${name} has an unsupported value: ${value}`);
  return value;
}

function normalizedText(value, name, fallback, maxLength = 120) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be a short single-line string`);
  }
  return value;
}

function normalizedThemeId(value, fallback = "custom") {
  const id = normalizedText(value, "id", fallback, 80);
  if (!THEME_ID_PATTERN.test(id)) throw new Error("id has an unsupported format");
  return id;
}

function isSupportedImageExtension(extension) {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(extension.toLowerCase());
}

function dataUrlForBytes(bytes, extension) {
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function loadThemeAsset(realThemeDir, relativePath, label, maxBytes) {
  if (relativePath === null || relativePath === undefined || relativePath === "") return null;
  const relative = normalizedText(relativePath, label, null, 240);
  if (!relative || path.isAbsolute(relative)) throw new Error(`${label} must be a relative path`);
  const assetPath = path.resolve(realThemeDir, relative);
  const relativeAsset = path.relative(realThemeDir, assetPath);
  if (!relativeAsset || relativeAsset.startsWith("..") || path.isAbsolute(relativeAsset)) {
    throw new Error(`${label} must remain inside the selected theme directory`);
  }
  const extension = path.extname(assetPath).toLowerCase();
  if (!isSupportedImageExtension(extension)) {
    throw new Error(`Unsupported ${label} image format: ${extension || "missing"}`);
  }
  const realAssetPath = await fs.realpath(assetPath);
  const realRelativeAsset = path.relative(realThemeDir, realAssetPath);
  if (!realRelativeAsset || realRelativeAsset.startsWith("..") || path.isAbsolute(realRelativeAsset)) {
    throw new Error(`${label} cannot escape through a link or junction`);
  }
  const stat = await fs.stat(realAssetPath);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`${label} must be a non-empty image within the ${maxBytes / 1024 / 1024} MB limit`);
  }
  const bytes = await fs.readFile(realAssetPath);
  const metadata = readImageMetadata(bytes, extension);
  if (!metadata) throw new Error(`${label} metadata is invalid or exceeds the image safety limit`);
  return {
    path: realAssetPath,
    relative,
    extension,
    bytes,
    dataUrl: dataUrlForBytes(bytes, extension),
    metadata,
    stamp: `${stat.size}:${stat.mtimeMs}`,
  };
}

async function loadTheme(themeDir) {
  const realThemeDir = await fs.realpath(themeDir);
  const themePath = path.join(realThemeDir, "theme.json");
  const themeText = await fs.readFile(themePath, "utf8");
  const raw = JSON.parse(themeText);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme root must be an object");
  }
  const image = normalizedText(raw.image, "image", null, 240);
  if (!image || path.isAbsolute(image)) throw new Error("Theme image must be a relative path");
  const imagePath = path.resolve(realThemeDir, image);
  const relativeImage = path.relative(realThemeDir, imagePath);
  if (!relativeImage || relativeImage.startsWith("..") || path.isAbsolute(relativeImage)) {
    throw new Error("Theme image must remain inside the selected theme directory");
  }
  const realImagePath = await fs.realpath(imagePath);
  const realRelativeImage = path.relative(realThemeDir, realImagePath);
  if (!realRelativeImage || realRelativeImage.startsWith("..") || path.isAbsolute(realRelativeImage)) {
    throw new Error("Theme image cannot escape through a link or junction");
  }
  const art = raw.art && typeof raw.art === "object" && !Array.isArray(raw.art) ? raw.art : {};
  const palette = raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette)
    ? raw.palette : {};
  const theme = {
    id: normalizedThemeId(raw.id, "custom"),
    name: normalizedText(raw.name, "name", "Codex Dream Skin", 120),
    image,
    appearance: normalizedChoice(raw.appearance, "appearance", THEME_CHOICES.appearance, "auto"),
    art: {
      focusX: normalizedUnit(art.focusX, "art.focusX"),
      focusY: normalizedUnit(art.focusY, "art.focusY"),
      safeArea: normalizedChoice(art.safeArea, "art.safeArea", THEME_CHOICES.safeArea, "auto"),
      taskMode: normalizedChoice(art.taskMode, "art.taskMode", THEME_CHOICES.taskMode, "auto"),
    },
    palette: {},
    branding: {},
  };
  for (const key of ["accent", "secondary", "surface", "text"]) {
    if (typeof palette[key] === "string" && palette[key].trim()) {
      const value = palette[key].trim();
      if (!/^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(value)) {
        throw new Error(`palette.${key} is not a supported CSS color`);
      }
      theme.palette[key] = value;
    }
  }
  const branding = raw.branding && typeof raw.branding === "object" && !Array.isArray(raw.branding)
    ? raw.branding : {};
  for (const key of ["logo", "polaroid"]) {
    const relative = branding[key] ?? raw[key] ?? null;
    if (relative !== null && relative !== undefined && relative !== "") theme.branding[key] = normalizedText(relative, `branding.${key}`, null, 240);
  }
  const [themeStat, imageStat] = await Promise.all([fs.stat(themePath), fs.stat(realImagePath)]);
  if (!imageStat.isFile()) throw new Error("Theme image is not a file");
  if (imageStat.size < 1) throw new Error("Theme image cannot be empty");
  if (imageStat.size > MAX_ART_BYTES) {
    throw new Error(`Theme image exceeds the ${MAX_ART_BYTES / 1024 / 1024} MB limit`);
  }
  const imageBytes = await fs.readFile(realImagePath);
  if (imageBytes.length < 1 || imageBytes.length > MAX_ART_BYTES) {
    throw new Error(`Theme image must be between 1 byte and ${MAX_ART_BYTES / 1024 / 1024} MB`);
  }
  const extension = path.extname(realImagePath).toLowerCase();
  if (!isSupportedImageExtension(extension)) {
    throw new Error(`Unsupported theme image format: ${extension || "missing"}`);
  }
  const artMetadata = readImageMetadata(imageBytes, extension);
  if (!artMetadata) {
    throw new Error("Theme image metadata is invalid or exceeds the 16384px / 50MP safety limit");
  }
  theme.artMetadata = artMetadata;
  const assets = {};
  for (const key of ["logo", "polaroid"]) {
    if (theme.branding[key]) assets[key] = await loadThemeAsset(realThemeDir, theme.branding[key], `branding.${key}`, MAX_BRANDING_BYTES);
  }
  const fingerprint = createHash("sha256")
    .update(themeText, "utf8")
    .update("\0")
    .update(imageBytes)
    .update(JSON.stringify(Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, value?.bytes ?? null]))))
    .digest("hex");
  theme.branding = Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, value.relative]));
  return {
    theme,
    themePath,
    imagePath: realImagePath,
    imageBytes,
    imageDataUrl: dataUrlForBytes(imageBytes, extension),
    assets,
    fingerprint,
    sourceStamp: `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}`,
  };
}

async function writeJsonAtomically(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function themeStateRoot(themeDir) {
  return path.dirname(path.resolve(themeDir));
}

function themeSelectionPath(themeDir) {
  return path.join(themeStateRoot(themeDir), "selected-theme.json");
}

function hiddenThemesPath(themeDir) {
  return path.join(themeStateRoot(themeDir), "hidden-themes.json");
}

function uiPreferencesPath(themeDir) {
  return path.join(themeStateRoot(themeDir), "ui-preferences.json");
}

async function readUiPreferences(themeDir) {
  try {
    const value = JSON.parse(await fs.readFile(uiPreferencesPath(themeDir), "utf8"));
    if (!value || value.schemaVersion !== UI_PREFERENCES_SCHEMA ||
        typeof value.showPolaroid !== "boolean") return { showPolaroid: true };
    return { showPolaroid: value.showPolaroid };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return { showPolaroid: true };
    throw error;
  }
}

async function writeUiPreferences(themeDir, preferences) {
  if (!preferences || typeof preferences.showPolaroid !== "boolean") {
    throw new Error("UI preferences have invalid fields");
  }
  await writeJsonAtomically(uiPreferencesPath(themeDir), {
    schemaVersion: UI_PREFERENCES_SCHEMA,
    showPolaroid: preferences.showPolaroid,
    updatedAt: new Date().toISOString(),
  });
}

async function readThemeSelection(themeDir) {
  try {
    const value = JSON.parse(await fs.readFile(themeSelectionPath(themeDir), "utf8"));
    if (!value || value.schemaVersion !== THEME_SELECTION_SCHEMA || !THEME_ID_PATTERN.test(value.themeId)) return null;
    return { themeId: value.themeId };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeThemeSelection(themeDir, themeId) {
  if (!THEME_ID_PATTERN.test(themeId)) throw new Error("Cannot persist an invalid theme ID");
  await writeJsonAtomically(themeSelectionPath(themeDir), {
    schemaVersion: THEME_SELECTION_SCHEMA,
    themeId,
    updatedAt: new Date().toISOString(),
  });
}

async function readHiddenThemeIds(themeDir) {
  try {
    const value = JSON.parse(await fs.readFile(hiddenThemesPath(themeDir), "utf8"));
    if (!value || value.schemaVersion !== HIDDEN_THEMES_SCHEMA || !Array.isArray(value.themeIds) ||
        value.themeIds.length > MAX_CATALOG_THEMES ||
        value.themeIds.some((themeId) => typeof themeId !== "string" || !THEME_ID_PATTERN.test(themeId))) {
      return new Set();
    }
    return new Set(value.themeIds);
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return new Set();
    throw error;
  }
}

async function writeHiddenThemeIds(themeDir, themeIds) {
  const values = [...new Set(themeIds)].sort();
  if (values.length > MAX_CATALOG_THEMES || values.some((themeId) => !THEME_ID_PATTERN.test(themeId))) {
    throw new Error("Cannot persist an invalid hidden-theme list");
  }
  await writeJsonAtomically(hiddenThemesPath(themeDir), {
    schemaVersion: HIDDEN_THEMES_SCHEMA,
    themeIds: values,
    updatedAt: new Date().toISOString(),
  });
}

async function loadThemeCatalog(themeDir) {
  const hiddenThemeIds = await readHiddenThemeIds(themeDir);
  const directories = [];
  const addDirectory = (directory, source) => {
    const resolved = path.resolve(directory);
    if (!directories.some((item) => item.directory.toLowerCase() === resolved.toLowerCase())) {
      directories.push({ directory: resolved, source });
    }
  };
  addDirectory(themeDir, "active");
  addDirectory(path.join(root, "assets"), "default");
  const presetRoot = path.join(root, "assets", "presets");
  try {
    for (const item of await fs.readdir(presetRoot, { withFileTypes: true })) {
      if (item.isDirectory()) addDirectory(path.join(presetRoot, item.name), "built-in");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const savedRoot = path.join(themeStateRoot(themeDir), "themes");
  try {
    for (const item of await fs.readdir(savedRoot, { withFileTypes: true })) {
      if (item.isDirectory()) addDirectory(path.join(savedRoot, item.name), "saved");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const entries = new Map();
  for (const item of directories.slice(0, MAX_CATALOG_THEMES * 2)) {
    try {
      const loaded = await loadTheme(item.directory);
      if (!hiddenThemeIds.has(loaded.theme.id) && !entries.has(loaded.theme.id)) {
        entries.set(loaded.theme.id, { ...loaded, source: item.source });
      }
    } catch (error) {
      if (item.source === "active" || item.source === "default") throw error;
    }
    if (entries.size >= MAX_CATALOG_THEMES) break;
  }
  if (!entries.size) throw new Error("No valid Dream Skin themes were found");
  const fingerprint = createHash("sha256")
    .update([...entries.values()].map((entry) => `${entry.theme.id}:${entry.fingerprint}`).join("\n"), "utf8")
    .digest("hex");
  return { entries, fingerprint };
}

function brandingDataFor(loadedTheme) {
  return Object.fromEntries(Object.entries(loadedTheme.assets ?? {}).map(([key, asset]) => [key, asset.dataUrl]));
}

function catalogPayloadFor(catalog, currentTheme) {
  const entries = [];
  let usedBytes = 0;
  for (const entry of catalog.entries.values()) {
    if (entry.theme.id === currentTheme.theme.id) continue;
    const item = {
      id: entry.theme.id,
      name: entry.theme.name,
      theme: entry.theme,
      source: entry.source,
      artDataUrl: null,
      branding: brandingDataFor(entry),
    };
    if (entry.imageBytes.length <= MAX_CATALOG_INLINE_BYTES &&
        usedBytes + entry.imageBytes.length <= MAX_CATALOG_BYTES) {
      item.artDataUrl = entry.imageDataUrl;
      usedBytes += entry.imageBytes.length;
    }
    entries.push(item);
  }
  return entries;
}

async function loadPayload(themeDir = path.join(root, "assets"), candidateTheme = null, catalog = null) {
  const loadedTheme = candidateTheme ?? await loadTheme(themeDir);
  const resolvedCatalog = catalog ?? await loadThemeCatalog(themeDir);
  const uiPreferences = await readUiPreferences(themeDir);
  const [css, template] = await Promise.all([
    fs.readFile(path.join(root, "assets", "dream-skin.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  ]);
  const artDataUrl = loadedTheme.imageDataUrl ?? dataUrlForBytes(
    loadedTheme.imageBytes,
    path.extname(loadedTheme.imagePath).toLowerCase(),
  );
  const payload = template
    .replace("__DREAM_CSS_JSON__", JSON.stringify(css))
    .replace("__DREAM_ART_JSON__", JSON.stringify(artDataUrl))
    .replace("__DREAM_THEME_JSON__", JSON.stringify(loadedTheme.theme))
    .replace("__DREAM_BRANDING_JSON__", JSON.stringify(brandingDataFor(loadedTheme)))
    .replace("__DREAM_CATALOG_JSON__", JSON.stringify(catalogPayloadFor(resolvedCatalog, loadedTheme)))
    .replace("__DREAM_CURRENT_SOURCE_JSON__", JSON.stringify(loadedTheme.source ?? "built-in"))
    .replace("__DREAM_UI_PREFERENCES_JSON__", JSON.stringify(uiPreferences));
  const { imageBytes: _imageBytes, ...themeState } = loadedTheme;
  return {
    ...themeState,
    themeFingerprint: loadedTheme.fingerprint,
    catalogFingerprint: resolvedCatalog.fingerprint,
    payloadFingerprint: createHash("sha256")
      .update(`${loadedTheme.fingerprint}:${resolvedCatalog.fingerprint}`, "utf8").digest("hex"),
    payload,
  };
}

function preferredFallbackEntry(catalog) {
  return catalog.entries.get("miku-488137") ??
    [...catalog.entries.values()].find((entry) => entry.source === "active") ??
    [...catalog.entries.values()].find((entry) => entry.source === "default") ??
    [...catalog.entries.values()].find((entry) => entry.source === "built-in") ??
    [...catalog.entries.values()][0] ?? null;
}

async function loadNativePayload(themeDir, catalog = null) {
  const resolvedCatalog = catalog ?? await loadThemeCatalog(themeDir);
  const baseTheme = preferredFallbackEntry(resolvedCatalog) ?? await loadTheme(themeDir);
  const nativeTheme = {
    ...baseTheme,
    source: "native",
    theme: {
      id: NATIVE_THEME_ID,
      name: "不使用主题",
      image: "",
      appearance: "auto",
      art: { focusX: null, focusY: null, safeArea: "auto", taskMode: "off" },
      palette: {},
      branding: {},
      nativeMode: true,
    },
    imageBytes: Buffer.alloc(0),
    imageDataUrl: "",
    assets: {},
    fingerprint: createHash("sha256")
      .update(`native:${resolvedCatalog.fingerprint}`, "utf8")
      .digest("hex"),
  };
  return loadPayload(themeDir, nativeTheme, resolvedCatalog);
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readThemeSourceStamp(loadedTheme) {
  const [themeStat, imageStat] = await Promise.all([
    fs.stat(loadedTheme.themePath),
    fs.stat(loadedTheme.imagePath),
  ]);
  return `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}`;
}

async function probeSession(session) {
  return session.evaluate(`(() => {
    const markers = {
      shell: Boolean(document.querySelector('main.main-surface')),
      sidebar: Boolean(document.querySelector('aside.app-shell-left-panel')),
      composer: Boolean(document.querySelector('.composer-surface-chrome')),
      main: Boolean(document.querySelector('[role="main"]')),
    };
    return {
      markers,
      codex: location.protocol === 'app:' && markers.shell && markers.sidebar && (markers.composer || markers.main),
    };
  })()`);
}

async function waitForCodexProbe(session, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  let probe = null;
  while (Date.now() < deadline) {
    try {
      probe = await probeSession(session);
      if (probe?.codex) return probe;
    } catch {
      // The renderer may be between documents while the early payload waits.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return probe;
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectCodexTargets(port, timeoutMs, expectedBrowserId) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await listAppTargets(port, expectedBrowserId);
      const connected = [];
      for (const target of targets) {
        let session;
        try {
          session = await connectTarget(target, port);
          const probe = await probeSession(session);
          if (probe?.codex) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched the expected Codex shell markers");
    } catch (error) {
      if (error instanceof CdpIdentityMismatchError) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified Codex renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

export function earlyPayloadFor(payload, revision) {
  return `(() => {
    const generationKey = "__CODEX_DREAM_SKIN_EARLY_GENERATION__";
    const appliedKey = "__CODEX_DREAM_SKIN_EARLY_APPLIED__";
    const generation = ${JSON.stringify(revision)};
    window[generationKey] = generation;
    let observer = null;
    let timeout = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const install = () => {
      if (window[generationKey] !== generation) { stop(); return true; }
      const root = document.documentElement;
      if (!root || !document.body) return false;
      const shell = document.querySelector('main.main-surface');
      const sidebar = document.querySelector('aside.app-shell-left-panel');
      if (!shell || !sidebar) return false;
      stop();
      ${payload};
      window[appliedKey] = generation;
      return true;
    };
    if (install()) return;
    if (typeof MutationObserver === "function" && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeout = setTimeout(stop, 10000);
  })()`;
}

async function registerEarlyPayload(session, payload, revision) {
  const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: earlyPayloadFor(payload, revision),
  });
  return result.identifier ?? null;
}

async function removeEarlyPayload(session, identifier) {
  if (!identifier || session.closed) return;
  await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.documentElement?.classList.remove(
      'codex-dream-skin', 'dream-theme-light', 'dream-theme-dark',
      'dream-art-wide', 'dream-art-standard', 'dream-focus-left',
      'dream-focus-center', 'dream-focus-right', 'dream-safe-left',
      'dream-safe-center', 'dream-safe-right', 'dream-safe-none',
       'dream-task-ambient', 'dream-task-banner', 'dream-task-off',
       'dream-has-logo', 'dream-has-polaroid'
    );
    for (const property of [
      '--dream-art', '--dream-art-position', '--dream-focus-x', '--dream-focus-y',
      '--dream-accent', '--dream-accent-ink', '--dream-image-luma', '--dream-secondary',
      '--dream-surface-base', '--dream-text-base', '--dream-logo', '--dream-polaroid'
    ]) document.documentElement?.style.removeProperty(property);
    document.querySelectorAll('.dream-home').forEach((node) => node.classList.remove('dream-home'));
    document.querySelectorAll('.dream-task').forEach((node) => node.classList.remove('dream-task'));
    document.querySelectorAll('.dream-home-shell').forEach((node) => node.classList.remove('dream-home-shell'));
     document.getElementById('codex-dream-skin-style')?.remove();
     document.getElementById('codex-dream-skin-chrome')?.remove();
     document.getElementById('codex-dream-theme-center')?.remove();
     document.getElementById('codex-dream-polaroid')?.remove();
    delete window.__CODEX_DREAM_SKIN_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('codex-dream-skin') &&
    !document.documentElement.style.getPropertyValue('--dream-art') &&
    !document.querySelector('.dream-home') &&
    !document.querySelector('.dream-task') &&
    !document.querySelector('.dream-home-shell') &&
    !document.getElementById('codex-dream-skin-style') &&
     !document.getElementById('codex-dream-skin-chrome') &&
     !document.getElementById('codex-dream-theme-center') &&
     !document.getElementById('codex-dream-polaroid') &&
    !window.__CODEX_DREAM_SKIN_STATE__
  )()`);
}

async function verifySession(session) {
  return session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const home = document.querySelector('.dream-home');
    const suggestions = home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cards = suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const result = {
      installed: document.documentElement.classList.contains('codex-dream-skin'),
      version: window.__CODEX_DREAM_SKIN_STATE__?.version ?? null,
      expectedVersion: ${JSON.stringify(SKIN_VERSION)},
      stylePresent: Boolean(document.getElementById('codex-dream-skin-style')),
      chromePresent: Boolean(document.getElementById('codex-dream-skin-chrome')),
      chromePointerEvents: getComputedStyle(document.getElementById('codex-dream-skin-chrome') || document.body).pointerEvents,
      homePresent: Boolean(home),
      suggestionsPresent: Boolean(suggestions),
      hero: box(home?.firstElementChild?.firstElementChild?.firstElementChild),
      cards,
      composer: box(document.querySelector('.composer-surface-chrome')),
      sidebar: box(document.querySelector('aside.app-shell-left-panel')),
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    result.pass = result.installed && result.version === result.expectedVersion &&
      result.stylePresent && result.chromePresent &&
      result.chromePointerEvents === 'none' && Boolean(result.composer) && Boolean(result.sidebar) &&
      (!result.homePresent || (Boolean(result.hero) &&
        (!result.suggestionsPresent || (result.cards.length >= 2 && result.cards.length <= 4))));
    return result;
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastResult = await verifySession(session);
      lastError = null;
      if (lastResult.pass) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!lastResult && lastError) throw lastError;
  return lastResult;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

export function strictThemeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
      typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId) ||
      typeof value.kind !== "string") {
    throw new Error("Theme request has an invalid envelope");
  }
  if (value.kind === "select-theme") {
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "kind,requestId,schemaVersion,themeId" ||
        typeof value.themeId !== "string" || !THEME_ID_PATTERN.test(value.themeId)) {
      throw new Error("Theme selection request has invalid fields");
    }
    return value;
  }
  if (value.kind === "native-mode") {
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "kind,requestId,schemaVersion") {
      throw new Error("Native mode request has invalid fields");
    }
    return value;
  }
  if (value.kind === "set-polaroid-visibility") {
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "kind,requestId,schemaVersion,visible" ||
        typeof value.visible !== "boolean") {
      throw new Error("Polaroid visibility request has invalid fields");
    }
    return value;
  }
  if (value.kind === "delete-theme") {
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "kind,requestId,schemaVersion,themeId" ||
        typeof value.themeId !== "string" || !THEME_ID_PATTERN.test(value.themeId) ||
        value.themeId === NATIVE_THEME_ID) {
      throw new Error("Theme deletion request has invalid fields");
    }
    return value;
  }
  if (value.kind === "custom-image") {
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "imageDataUrl,inheritThemeId,kind,name,requestId,schemaVersion" ||
        typeof value.inheritThemeId !== "string" || !THEME_ID_PATTERN.test(value.inheritThemeId) ||
        typeof value.name !== "string" || value.name.length < 1 || value.name.length > 80 ||
        /[\u0000-\u001f]/.test(value.name) ||
        typeof value.imageDataUrl !== "string") {
      throw new Error("Custom image request has invalid fields");
    }
    return value;
  }
  throw new Error(`Unsupported theme request kind: ${value.kind}`);
}

async function takeThemeRequest(session) {
  const value = await session.evaluate(`(() => {
    const key = ${JSON.stringify(THEME_REQUEST_KEY)};
    const request = window[key] ?? null;
    if (request) delete window[key];
    return request;
  })()`);
  return value === null ? null : strictThemeRequest(value);
}

async function writeThemeAck(session, ack) {
  if (session?.closed) return;
  await session.evaluate(`window[${JSON.stringify(THEME_ACK_KEY)}] = ${JSON.stringify(ack)};`).catch(() => {});
}

export function decodeImageDataUrl(value) {
  const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new Error("Custom image must be a base64 PNG, JPEG, or WebP data URL");
  const extension = match[1].toLowerCase() === "jpeg" ? ".jpg" : `.${match[1].toLowerCase()}`;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_CUSTOM_BYTES) throw new Error("Custom image exceeds the 8 MB limit");
  if (!readImageMetadata(bytes, extension)) throw new Error("Custom image metadata is invalid or unsafe");
  return { bytes, extension };
}

async function writeBytesAtomically(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function createCustomTheme(themeDir, request, inherited) {
  const { bytes, extension } = decodeImageDataUrl(request.imageDataUrl);
  const savedRoot = path.join(themeStateRoot(themeDir), "themes");
  const customDirectory = path.join(savedRoot, "renderer-custom");
  await fs.mkdir(savedRoot, { recursive: true });
  await fs.mkdir(customDirectory, { recursive: true });
  const realSavedRoot = await fs.realpath(savedRoot);
  const realCustomDirectory = await fs.realpath(customDirectory);
  const relative = path.relative(realSavedRoot, realCustomDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Custom theme escaped the managed themes directory");
  const imageName = `art-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
  const imagePath = path.join(realCustomDirectory, imageName);
  await writeBytesAtomically(imagePath, bytes);
  const inheritedTheme = inherited?.theme ?? {};
  const branding = {};
  for (const key of ["logo", "polaroid"]) {
    const asset = inherited?.assets?.[key];
    if (!asset) continue;
    const assetName = `${key}${asset.extension}`;
    await writeBytesAtomically(path.join(realCustomDirectory, assetName), asset.bytes);
    branding[key] = assetName;
  }
  const theme = {
    id: "custom-upload",
    name: request.name.trim(),
    image: imageName,
    appearance: "auto",
    art: { focusX: null, focusY: null, safeArea: "auto", taskMode: "auto" },
    palette: inheritedTheme.palette ?? {},
    branding,
  };
  await writeJsonAtomically(path.join(realCustomDirectory, "theme.json"), theme);
  for (const item of await fs.readdir(realCustomDirectory, { withFileTypes: true })) {
    if (item.isFile() && /^art-/.test(item.name) && item.name !== imageName) {
      await fs.rm(path.join(realCustomDirectory, item.name), { force: true }).catch(() => {});
    }
  }
  return loadTheme(realCustomDirectory);
}

export async function deleteSavedTheme(themeDir, themeId, catalog) {
  if (!THEME_ID_PATTERN.test(themeId) || themeId === NATIVE_THEME_ID) {
    throw new Error("Cannot delete an invalid theme ID");
  }
  const entry = catalog?.entries?.get(themeId);
  if (!entry || entry.source !== "saved") {
    throw new Error("Only themes in My Themes can be deleted");
  }
  const savedRoot = path.join(themeStateRoot(themeDir), "themes");
  const [realSavedRoot, realThemeDirectory] = await Promise.all([
    fs.realpath(savedRoot),
    fs.realpath(path.dirname(entry.themePath)),
  ]);
  const relative = path.relative(realSavedRoot, realThemeDirectory);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || segments.length !== 1) {
    throw new Error("Theme deletion escaped the managed saved-theme directory");
  }
  const realThemePath = await fs.realpath(entry.themePath);
  if (path.dirname(realThemePath).toLowerCase() !== realThemeDirectory.toLowerCase() ||
      path.basename(realThemePath).toLowerCase() !== "theme.json") {
    throw new Error("Theme deletion rejected an unexpected theme manifest path");
  }
  await fs.rm(realThemeDirectory, { recursive: true });
  return entry;
}

export async function deleteTheme(themeDir, themeId, catalog) {
  if (!THEME_ID_PATTERN.test(themeId) || themeId === NATIVE_THEME_ID) {
    throw new Error("Cannot delete an invalid theme ID");
  }
  const entry = catalog?.entries?.get(themeId);
  if (!entry) throw new Error("Theme is not present in the watcher catalog");
  if (entry.source === "saved") {
    await deleteSavedTheme(themeDir, themeId, catalog);
    return { entry, mode: "deleted" };
  }
  if (!["active", "default", "built-in"].includes(entry.source)) {
    throw new Error("Theme source cannot be deleted");
  }
  const remaining = [...catalog.entries.values()].filter((candidate) => candidate.theme.id !== themeId);
  if (!remaining.length) throw new Error("Cannot hide the final available theme");
  const hiddenThemeIds = await readHiddenThemeIds(themeDir);
  hiddenThemeIds.add(themeId);
  await writeHiddenThemeIds(themeDir, hiddenThemeIds);
  return { entry, mode: "hidden" };
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs, options.browserId);
  const loadedPayload = (options.mode === "once" || options.reload)
    ? await loadPayload(options.themeDir) : null;
  const payload = loadedPayload?.payload ?? null;
  const results = [];
  let screenshotCaptured = false;
  try {
    for (const { target, session, probe } of connected) {
      try {
        if (options.mode === "remove") await removeFromSession(session);
        else if (options.mode === "once") await applyToSession(session, payload);
        if (options.mode === "once") {
          await new Promise((resolve) => setTimeout(resolve, 850));
        }
        if (options.reload) {
          await session.send("Page.reload", { ignoreCache: true });
          await new Promise((resolve) => setTimeout(resolve, 1600));
          if (options.mode !== "remove") await applyToSession(session, payload);
        }
        const verified = options.mode === "remove"
          ? await verifyRemovedSession(session)
          : (options.reload || options.mode === "once" || options.mode === "verify")
            ? await waitForVerifiedSession(session, options.timeoutMs)
            : await verifySession(session);
        results.push({ targetId: target.id, markers: probe.markers, result: verified });
        if (options.screenshot && !screenshotCaptured) {
          await capture(session, options.screenshot);
          screenshotCaptured = true;
        }
      } finally {
        session.close();
      }
    }
  } finally {
    for (const { session } of connected) session.close();
  }
  console.log(JSON.stringify({ mode: options.mode, port: options.port, targets: results }, null, 2));
  const failed = results.length === 0 || results.some((item) =>
    options.mode === "remove" ? item.result !== true : !item.result?.pass);
  if (failed) process.exitCode = 2;
}

async function runWatch(options) {
  const identityAnchor = await connectBrowserIdentityAnchor(options.port, options.browserId);
  const sessions = new Map();
  const earlyScripts = new Map();
  const fallbackTargets = new Map();
  const fallbackListeners = new Set();
  const targetFailures = new Map();
  let stopping = false;
  let listFailures = 0;
  let lastListErrorLogAt = 0;
  let lastThemeErrorLogAt = 0;
  let lastStrongThemeAuditAt = 0;
  let loadedPayload = null;
  let themeCatalog = null;
  let selectedThemeId = null;
  let activeThemeFingerprint = null;
  let paused = false;
  const stop = () => { stopping = true; };
  const rejectTarget = (target, baseDelayMs, error = null) => {
    const previous = targetFailures.get(target.id) ?? { failures: 0, lastLogAt: 0 };
    const failures = previous.failures + 1;
    const delayMs = Math.min(30000, baseDelayMs * (2 ** Math.min(failures - 1, 4)));
    const now = Date.now();
    if (error && (failures === 1 || now - previous.lastLogAt >= 30000)) {
      console.error(`[dream-skin] inject failed for ${target.id}: ${error.message}; retrying in ${delayMs}ms`);
      previous.lastLogAt = now;
    }
    targetFailures.set(target.id, { failures, lastLogAt: previous.lastLogAt, until: now + delayMs });
  };
  const attachLoadFallback = (id, target, session) => {
    if (fallbackListeners.has(id)) return;
    fallbackListeners.add(id);
    let lastReinjectErrorLogAt = 0;
    session.on("Page.loadEventFired", () => {
      if (!fallbackTargets.get(id)) return;
      setTimeout(() => {
        const operation = paused ? removeFromSession(session) : applyToSession(session, loadedPayload.payload);
        operation.catch((error) => {
          if (Date.now() - lastReinjectErrorLogAt >= 30000) {
            console.error(`[dream-skin] reinject failed for ${target.id}: ${error.message}`);
            lastReinjectErrorLogAt = Date.now();
          }
        });
      }, 250);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    themeCatalog = await loadThemeCatalog(options.themeDir);
    const activeTheme = await loadTheme(options.themeDir);
    activeThemeFingerprint = activeTheme.fingerprint;
    const savedSelection = await readThemeSelection(options.themeDir);
    if (savedSelection?.themeId === NATIVE_THEME_ID) {
      selectedThemeId = NATIVE_THEME_ID;
      loadedPayload = await loadNativePayload(options.themeDir, themeCatalog);
    } else {
      const initialEntry = (savedSelection && themeCatalog.entries.get(savedSelection.themeId)) ||
        themeCatalog.entries.get(activeTheme.theme.id) || preferredFallbackEntry(themeCatalog);
      if (!initialEntry) throw new Error("No selectable Dream Skin theme remains");
      selectedThemeId = initialEntry.theme.id;
      if (!savedSelection || savedSelection.themeId !== selectedThemeId) {
        await writeThemeSelection(options.themeDir, selectedThemeId);
      }
       loadedPayload = await loadPayload(options.themeDir, initialEntry, themeCatalog);
    }
    lastStrongThemeAuditAt = Date.now();
    paused = await fileExists(options.pauseFile);
    while (!stopping) {
      if (identityAnchor.closed) {
        console.error("[dream-skin] original CDP browser identity closed; watcher is stopping instead of reconnecting");
        process.exitCode = 3;
        break;
      }
      let targets = [];
      try {
        targets = await listAppTargets(options.port);
        listFailures = 0;
      } catch (error) {
        listFailures += 1;
        const retryMs = Math.min(10000, 1000 * (2 ** Math.min(listFailures - 1, 4)));
        if (listFailures === 1 || Date.now() - lastListErrorLogAt >= 30000) {
          console.error(`[dream-skin] ${new Date().toISOString()} ${error.message}; retrying in ${retryMs}ms`);
          lastListErrorLogAt = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }

      const nextPaused = await fileExists(options.pauseFile);
      let nextPayload = loadedPayload;
      let nextCatalog = themeCatalog;
      let requestForAck = null;
      for (const session of sessions.values()) {
        let request;
        try {
          request = await takeThemeRequest(session);
        } catch (error) {
          await writeThemeAck(session, { schemaVersion: 1, status: "error", message: error.message });
          continue;
        }
        if (!request) continue;
        requestForAck = { session, request };
        try {
          nextCatalog = await loadThemeCatalog(options.themeDir);
          let selectedEntry = null;
          let deletedThemeId = null;
          let deleteMode = null;
          if (request.kind === "set-polaroid-visibility") {
            await writeUiPreferences(options.themeDir, { showPolaroid: request.visible });
            if (selectedThemeId === NATIVE_THEME_ID) {
              nextPayload = await loadNativePayload(options.themeDir, nextCatalog);
            } else {
              selectedEntry = nextCatalog.entries.get(selectedThemeId) ?? preferredFallbackEntry(nextCatalog);
              if (!selectedEntry) throw new Error("No selectable Dream Skin theme remains");
              nextPayload = await loadPayload(options.themeDir, selectedEntry, nextCatalog);
            }
          } else if (request.kind === "native-mode") {
            selectedThemeId = NATIVE_THEME_ID;
            await writeThemeSelection(options.themeDir, selectedThemeId);
            nextPayload = await loadNativePayload(options.themeDir, nextCatalog);
          } else if (request.kind === "delete-theme") {
            deletedThemeId = request.themeId;
            ({ mode: deleteMode } = await deleteTheme(options.themeDir, request.themeId, nextCatalog));
            nextCatalog = await loadThemeCatalog(options.themeDir);
            if (selectedThemeId === request.themeId ||
                (selectedThemeId !== NATIVE_THEME_ID && !nextCatalog.entries.has(selectedThemeId))) {
              selectedEntry = preferredFallbackEntry(nextCatalog);
              if (!selectedEntry) throw new Error("No safe fallback theme remains after deletion");
              selectedThemeId = selectedEntry.theme.id;
              await writeThemeSelection(options.themeDir, selectedThemeId);
            }
            nextPayload = selectedThemeId === NATIVE_THEME_ID
              ? await loadNativePayload(options.themeDir, nextCatalog)
              : await loadPayload(
                options.themeDir,
                selectedEntry ?? nextCatalog.entries.get(selectedThemeId),
                nextCatalog,
              );
          } else if (request.kind === "select-theme") {
            selectedEntry = nextCatalog.entries.get(request.themeId);
            if (!selectedEntry) throw new Error(`Theme is not present in the watcher catalog: ${request.themeId}`);
            selectedThemeId = selectedEntry.theme.id;
            await writeThemeSelection(options.themeDir, selectedThemeId);
            nextPayload = await loadPayload(options.themeDir, selectedEntry, nextCatalog);
          } else {
            const inherited = nextCatalog.entries.get(request.inheritThemeId);
            if (!inherited) throw new Error(`Inherited theme is not present in the watcher catalog: ${request.inheritThemeId}`);
            selectedEntry = await createCustomTheme(options.themeDir, request, inherited);
            nextCatalog = await loadThemeCatalog(options.themeDir);
            selectedEntry = nextCatalog.entries.get(selectedEntry.theme.id) ?? selectedEntry;
            selectedThemeId = selectedEntry.theme.id;
            await writeThemeSelection(options.themeDir, selectedThemeId);
            nextPayload = await loadPayload(options.themeDir, selectedEntry, nextCatalog);
          }
          await writeThemeAck(session, {
            schemaVersion: 1,
            status: "accepted",
            requestId: request.requestId,
            themeId: selectedThemeId,
            ...(deletedThemeId ? { deletedThemeId } : {}),
            ...(deleteMode ? { deleteMode } : {}),
          });
        } catch (error) {
          await writeThemeAck(session, {
            schemaVersion: 1,
            status: "error",
            requestId: request.requestId,
            message: error.message,
          });
          requestForAck = null;
        }
        break;
      }
      if (!nextPaused) {
        try {
          const now = Date.now();
          let shouldAudit = !loadedPayload || now - lastStrongThemeAuditAt >= STRONG_THEME_AUDIT_MS;
          const activeCandidate = await loadTheme(options.themeDir);
          const activeChanged = activeCandidate.fingerprint !== activeThemeFingerprint;
          if (!shouldAudit) {
            try {
              shouldAudit = activeChanged || await readThemeSourceStamp(loadedPayload) !== loadedPayload.sourceStamp;
            } catch {
              shouldAudit = true;
            }
          }
          if (shouldAudit) {
            nextCatalog = await loadThemeCatalog(options.themeDir);
            lastStrongThemeAuditAt = now;
            activeThemeFingerprint = activeCandidate.fingerprint;
            if (activeChanged && selectedThemeId !== NATIVE_THEME_ID &&
                nextCatalog.entries.has(activeCandidate.theme.id)) {
              selectedThemeId = activeCandidate.theme.id;
              await writeThemeSelection(options.themeDir, selectedThemeId);
            }
            if (selectedThemeId === NATIVE_THEME_ID) {
              const selectedChanged = !loadedPayload || loadedPayload.theme.id !== NATIVE_THEME_ID ||
                nextCatalog.fingerprint !== themeCatalog.fingerprint;
              if (selectedChanged) nextPayload = await loadNativePayload(options.themeDir, nextCatalog);
              else loadedPayload.sourceStamp = activeCandidate.sourceStamp;
            } else {
              const selectedEntry = nextCatalog.entries.get(selectedThemeId) ?? preferredFallbackEntry(nextCatalog);
              if (!selectedEntry) throw new Error("No selectable Dream Skin theme remains");
              if (selectedEntry.theme.id !== selectedThemeId) {
                selectedThemeId = selectedEntry.theme.id;
                await writeThemeSelection(options.themeDir, selectedThemeId);
              }
              const selectedChanged = !loadedPayload || selectedEntry.fingerprint !== loadedPayload.themeFingerprint ||
                nextCatalog.fingerprint !== themeCatalog.fingerprint;
              if (selectedChanged) {
                nextPayload = await loadPayload(options.themeDir, selectedEntry, nextCatalog);
              } else {
                loadedPayload.sourceStamp = selectedEntry.sourceStamp;
              }
            }
          }
        } catch (error) {
          if (Date.now() - lastThemeErrorLogAt >= 30000) {
            console.error(`[dream-skin] theme update rejected: ${error.message}; keeping the active theme`);
            lastThemeErrorLogAt = Date.now();
          }
        }
      }
      const pauseChanged = nextPaused !== paused;
      const payloadChanged = !nextPaused && nextPayload !== loadedPayload;
      themeCatalog = nextCatalog;
      loadedPayload = nextPayload;
      paused = nextPaused;

      if (pauseChanged || payloadChanged) {
        for (const [id, session] of sessions) {
          try {
            const previousEarlyScript = earlyScripts.get(id);
            if (paused) {
              await removeFromSession(session);
              await removeEarlyPayload(session, previousEarlyScript);
              earlyScripts.delete(id);
              fallbackTargets.delete(id);
              fallbackListeners.delete(id);
            } else {
              let nextEarlyScript = null;
              try {
                nextEarlyScript = await registerEarlyPayload(
                  session,
                  loadedPayload.payload,
                  loadedPayload.payloadFingerprint,
                );
                if (!nextEarlyScript) throw new Error("CDP did not return an early-script identifier");
                fallbackTargets.set(id, false);
              } catch (error) {
                fallbackTargets.set(id, true);
                console.error(`[dream-skin] early theme refresh unavailable for ${id}: ${error.message}`);
                attachLoadFallback(id, { id }, session);
              }
              if (nextEarlyScript) earlyScripts.set(id, nextEarlyScript);
              else earlyScripts.delete(id);
              await removeEarlyPayload(session, previousEarlyScript);
              await applyToSession(session, loadedPayload.payload);
            }
          } catch (error) {
            console.error(`[dream-skin] live theme update failed for ${id}: ${error.message}`);
            await removeEarlyPayload(session, earlyScripts.get(id));
            earlyScripts.delete(id);
            fallbackTargets.delete(id);
            fallbackListeners.delete(id);
            session.close();
            sessions.delete(id);
          }
        }
        console.log(paused ? "[dream-skin] paused" : `[dream-skin] active theme ${loadedPayload.theme.id}`);
      }

      const activeIds = new Set(targets.map((target) => target.id));
      for (const id of targetFailures.keys()) {
        if (!activeIds.has(id)) targetFailures.delete(id);
      }
      for (const [id, session] of sessions) {
        if (!activeIds.has(id) || session.closed) {
          await removeEarlyPayload(session, earlyScripts.get(id));
          earlyScripts.delete(id);
          fallbackTargets.delete(id);
          fallbackListeners.delete(id);
          session.close();
          sessions.delete(id);
          targetFailures.delete(id);
        }
      }

      for (const target of targets) {
        if (identityAnchor.closed) break;
        if (sessions.has(target.id)) continue;
        if ((targetFailures.get(target.id)?.until ?? 0) > Date.now()) continue;
        let session;
        let earlyScriptId = null;
        try {
          session = await connectTarget(target, options.port);
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyInjectionFallback = false;
          if (!paused) {
            try {
                earlyScriptId = await registerEarlyPayload(
                  session,
                  loadedPayload.payload,
                  loadedPayload.payloadFingerprint,
                );
              if (!earlyScriptId) throw new Error("CDP did not return an early-script identifier");
              await session.evaluate(earlyPayloadFor(loadedPayload.payload, loadedPayload.payloadFingerprint));
            } catch (error) {
              await removeEarlyPayload(session, earlyScriptId);
              earlyScriptId = null;
              earlyInjectionFallback = true;
              console.error(`[dream-skin] early injection unavailable for ${target.id}: ${error.message}`);
            }
          }
          const probe = await waitForCodexProbe(session);
          if (!probe?.codex) {
            await removeEarlyPayload(session, earlyScriptId);
            rejectTarget(target, 5000);
            session.close();
            continue;
          }
          fallbackTargets.set(target.id, earlyInjectionFallback);
          if (earlyInjectionFallback) attachLoadFallback(target.id, target, session);
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyApplied = false;
          if (!paused && !earlyInjectionFallback) {
            earlyApplied = await session.evaluate(
              `window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === ${JSON.stringify(loadedPayload.payloadFingerprint)}`,
            ).catch(() => false);
          }
          if (paused) await removeFromSession(session);
          else if (!earlyApplied) await applyToSession(session, loadedPayload.payload);
          sessions.set(target.id, session);
          if (earlyScriptId) earlyScripts.set(target.id, earlyScriptId);
          targetFailures.delete(target.id);
          console.log(`[dream-skin] injected target ${target.id}`);
        } catch (error) {
          await removeEarlyPayload(session, earlyScriptId);
          fallbackTargets.delete(target.id);
          fallbackListeners.delete(target.id);
          session?.close();
          if (identityAnchor.closed || error instanceof CdpIdentityMismatchError) break;
          rejectTarget(target, 2500, error);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } finally {
    identityAnchor.close();
    for (const [id, session] of sessions) {
      await removeEarlyPayload(session, earlyScripts.get(id));
      session.close();
    }
    earlyScripts.clear();
    fallbackTargets.clear();
    fallbackListeners.clear();
  }
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "self-test") {
  const valid = validatedDebuggerUrl({ webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/test` }, options.port);
  const browserId = browserIdFromVersion({
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/test-browser`,
  }, options.port);
  const invalid = [
    "ws://example.com/devtools/page/test",
    `ws://127.0.0.1:${options.port + 1}/devtools/page/test`,
    `wss://127.0.0.1:${options.port}/devtools/page/test`,
    `ws://user@127.0.0.1:${options.port}/devtools/page/test`,
    `ws://127.0.0.1:${options.port}/unexpected/test`,
    `ws://127.0.0.1:${options.port}/devtools/page/test?query=1`,
  ];
  for (const value of invalid) {
    let rejected = false;
    try { validatedDebuggerUrl({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`CDP URL validation accepted an unsafe URL: ${value}`);
  }
  const invalidBrowserUrls = [
    `ws://127.0.0.1:${options.port}/devtools/page/not-a-browser`,
    `ws://127.0.0.1:${options.port}/devtools/browser/bad%20id`,
    `ws://127.0.0.1:${options.port}/devtools/browser/test?query=1`,
  ];
  for (const value of invalidBrowserUrls) {
    let rejected = false;
    try { browserIdFromVersion({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`Browser identity validation accepted an unsafe URL: ${value}`);
  }
  const validPageTarget = {
    id: "page-test",
    type: "page",
    url: "app://codex/",
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/page-test`,
  };
  const invalidPageTargets = [
    { ...validPageTarget, webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/page-test` },
    { ...validPageTarget, id: "other-page" },
    { ...validPageTarget, id: 123 },
    { ...validPageTarget, type: "other" },
  ];
  if (!valid || browserId !== "test-browser" || !isValidCdpPageTarget(validPageTarget, options.port) ||
      invalidPageTargets.some((item) => isValidCdpPageTarget(item, options.port))) {
    throw new Error("CDP URL and target validation self-test failed");
  }
  const validMessage = parseCdpMessage('{"id":7,"result":{"ok":true}}');
  const invalidMessages = ["{not-json", "null", '"text"', "42", "true"];
  if (validMessage?.id !== 7 || validMessage.result?.ok !== true ||
      invalidMessages.some((value) => parseCdpMessage(value) !== null)) {
    throw new Error("CDP message validation self-test failed");
  }
  if (/dispatchKeyEvent|dispatchMouseEvent/.test(capture.toString())) {
    throw new Error("Screenshot capture must not dispatch renderer input events");
  }
  console.log(JSON.stringify({ pass: true, version: SKIN_VERSION, test: "loopback-cdp-validation" }));
  } else if (options.mode === "check-payload") {
    const loaded = await loadPayload(options.themeDir);
    const unresolved = ["__DREAM_CSS_JSON__", "__DREAM_ART_JSON__", "__DREAM_THEME_JSON__",
      "__DREAM_BRANDING_JSON__", "__DREAM_CATALOG_JSON__", "__DREAM_UI_PREFERENCES_JSON__"]
      .some((placeholder) => loaded.payload.includes(placeholder));
    if (unresolved) {
      throw new Error("Payload placeholders were not fully replaced");
    }
    console.log(JSON.stringify({
      pass: true,
      version: SKIN_VERSION,
      payloadBytes: Buffer.byteLength(loaded.payload),
      themeId: loaded.theme.id,
      appearance: loaded.theme.appearance,
      art: loaded.theme.art,
      artMetadata: loaded.theme.artMetadata ?? null,
    }));
  } else if (options.mode === "watch") await runWatch(options);
  else await runOneShot(options);
}
