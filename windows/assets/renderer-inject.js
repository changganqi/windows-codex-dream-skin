((cssText, artDataUrl, rawConfig, rawBranding, rawCatalog, rawCurrentSource, rawUiPreferences) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const STYLE_ID = "codex-dream-skin-style";
  const CHROME_ID = "codex-dream-skin-chrome";
  const THEME_CENTER_ID = "codex-dream-theme-center";
  const POLAROID_ID = "codex-dream-polaroid";
  const THEME_REQUEST_KEY = "__CODEX_DREAM_SKIN_THEME_REQUEST__";
  const THEME_ACK_KEY = "__CODEX_DREAM_SKIN_THEME_ACK__";
  const NATIVE_THEME_ID = "codex-native";
  const ROOT_CLASSES = [
    "codex-dream-skin",
    "dream-theme-light",
    "dream-theme-dark",
    "dream-art-wide",
    "dream-art-standard",
    "dream-focus-left",
    "dream-focus-center",
    "dream-focus-right",
    "dream-safe-left",
    "dream-safe-center",
    "dream-safe-right",
    "dream-safe-none",
    "dream-task-ambient",
    "dream-task-banner",
    "dream-task-off",
    "dream-has-logo",
    "dream-has-polaroid",
  ];
  const ROOT_PROPERTIES = [
    "--dream-art",
    "--dream-art-position",
    "--dream-focus-x",
    "--dream-focus-y",
    "--dream-accent",
    "--dream-accent-ink",
    "--dream-image-luma",
    "--dream-secondary",
    "--dream-surface-base",
    "--dream-text-base",
    "--dream-logo",
    "--dream-polaroid",
  ];
  const HOME_UTILITY_CLASS = "dream-home-utility";
  const MAIN_SURFACE_CLASS = "dream-main-surface";
  const installToken = {};
  let samplingNativeShell = false;
  let observer = null;
  let themeCenter = null;
  let themeCenterDisposers = [];
  let forcedElectronAppearance = null;
  let originalElectronAppearance = null;
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)));
  const luminance = (red, green, blue) => {
    const linear = [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const defaultProfile = {
    appearance: "dark",
    accent: [108, 131, 142],
    focusX: .5,
    focusY: .5,
    aspect: 1.6,
    luma: .32,
    safeArea: "center",
    palette: {
      accent: "#6c838e",
      secondary: "#a8b4ba",
      surface: "#171b1d",
      text: "#f5f7f8",
    },
  };

  const normalizeConfig = (value) => {
    const config = value && typeof value === "object" ? value : {};
    const art = config.art && typeof config.art === "object" ? config.art : {};
    const hasNumber = (candidate) =>
      (typeof candidate === "number" || (typeof candidate === "string" && candidate.trim() !== "")) &&
      Number.isFinite(Number(candidate));
    const color = (key) => {
      const requested = typeof config?.palette?.[key] === "string" ? config.palette[key].trim() : "";
      return /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(requested) ? requested : null;
    };
    const appearance = ["auto", "light", "dark"].includes(config.appearance)
      ? config.appearance
      : "auto";
    const safeArea = ["auto", "left", "right", "center", "none"].includes(art.safeArea)
      ? art.safeArea
      : "auto";
    const taskMode = ["auto", "ambient", "banner", "off"].includes(art.taskMode)
      ? art.taskMode
      : "auto";
    const metadataRatio = Number(config?.artMetadata?.ratio);
    return {
      appearance,
      safeArea,
      taskMode,
      focusX: hasNumber(art.focusX) ? clamp(art.focusX) : null,
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      accent: color("accent"),
      secondary: color("secondary"),
      surface: color("surface"),
      text: color("text"),
      initialAspect: Number.isFinite(metadataRatio) && metadataRatio > 0 ? metadataRatio : null,
    };
  };

  const previous = window[STATE_KEY];
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.ackTimer) clearInterval(previous.ackTimer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  previous?.disposeThemeCenter?.();
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  for (const url of previous?.brandingUrls ? Object.values(previous.brandingUrls) : []) URL.revokeObjectURL(url);
  document.getElementById(THEME_CENTER_ID)?.remove();
  document.getElementById(POLAROID_ID)?.remove();
  const toObjectUrl = (dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
    const source = dataUrl;
    const sourceComma = source.indexOf(",");
    const binary = atob(source.slice(sourceComma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const mime = /^data:([^;,]+)/.exec(source)?.[1] || "image/png";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };
  let artUrl = toObjectUrl(artDataUrl);
  let currentArtDataUrl = typeof artDataUrl === "string" ? artDataUrl : "";
  let branding = rawBranding && typeof rawBranding === "object" ? rawBranding : {};
  let brandingUrls = Object.fromEntries(Object.entries(branding).map(([key, value]) => [key, toObjectUrl(value)]).filter(([, value]) => value));
  let catalog = Array.isArray(rawCatalog) ? rawCatalog.filter((entry) => entry && typeof entry === "object") : [];
  let currentTheme = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  let currentSource = typeof rawCurrentSource === "string" ? rawCurrentSource : "built-in";
  let showPolaroid = rawUiPreferences?.showPolaroid !== false;
  let nativeMode = currentTheme.id === NATIVE_THEME_ID || currentTheme.nativeMode === true;
  let config = normalizeConfig(currentTheme);
  let profile = {
    ...defaultProfile,
    aspect: config.initialAspect ?? defaultProfile.aspect,
  };
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.dreamVersion = "5";
  }

  const hexColor = (red, green, blue) => `#${[red, green, blue]
    .map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
  const mixColor = (first, second, amount) => first.map((value, index) =>
    value + (second[index] - value) * amount);

  const analyzeDecodedImage = (image) => {
        const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width || 1));
        const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height || 1));
        const sampleScale = Math.min(1, 48 / sourceWidth, 48 / sourceHeight);
        const width = Math.max(1, Math.floor(sourceWidth * sampleScale));
        const height = Math.max(1, Math.floor(sourceHeight * sampleScale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let count = 0;
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let totalBrightness = 0;
        const samples = [];
        const sampleMap = new Array(width * height);
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 96) continue;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const light = (.2126 * red + .7152 * green + .0722 * blue) / 255;
          const sample = { red, green, blue, light, index: offset / 4 };
          samples.push(sample);
          sampleMap[sample.index] = sample;
          totalRed += red;
          totalGreen += green;
          totalBlue += blue;
          totalBrightness += light;
          count += 1;
        }
        if (!count) throw new Error("Image contains no opaque pixels");
        const average = [totalRed / count, totalGreen / count, totalBlue / count];
        const averageBrightness = totalBrightness / count;
        const information = (start, end) => {
          let total = 0;
          let totalSquared = 0;
          let edges = 0;
          let edgeCount = 0;
          let sampleCount = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const sample = sampleMap[y * width + x];
              if (!sample) continue;
              total += sample.light;
              totalSquared += sample.light * sample.light;
              sampleCount += 1;
              const previousSample = x > start ? sampleMap[y * width + x - 1] : null;
              const above = y > 0 ? sampleMap[(y - 1) * width + x] : null;
              if (previousSample) { edges += Math.abs(sample.light - previousSample.light); edgeCount += 1; }
              if (above) { edges += Math.abs(sample.light - above.light); edgeCount += 1; }
            }
          }
          const mean = sampleCount ? total / sampleCount : 0;
          const variance = sampleCount ? Math.max(0, totalSquared / sampleCount - mean * mean) : 1;
          return Math.sqrt(variance) * .58 + (edgeCount ? edges / edgeCount : 1) * .42;
        };
        const zoneWidth = Math.max(1, Math.floor(width * .38));
        const leftInformation = information(0, zoneWidth);
        const rightInformation = information(width - zoneWidth, width);
        let safeArea = "center";
        if (leftInformation < rightInformation * .86) safeArea = "left";
        else if (rightInformation < leftInformation * .86) safeArea = "right";
        let focusWeight = 0;
        let focusX = 0;
        let focusY = 0;
        let accentWeight = 0;
        let accent = [0, 0, 0];
        const colorBuckets = new Map();
        for (const sample of samples) {
          const x = sample.index % width;
          const y = Math.floor(sample.index / width);
          const difference = Math.sqrt(
            (sample.red - average[0]) ** 2 +
            (sample.green - average[1]) ** 2 +
            (sample.blue - average[2]) ** 2,
          ) / 441.7;
          const saliency = .03 + difference ** 1.35;
          focusX += (x / Math.max(1, width - 1)) * saliency;
          focusY += (y / Math.max(1, height - 1)) * saliency;
          focusWeight += saliency;
          const max = Math.max(sample.red, sample.green, sample.blue);
          const min = Math.min(sample.red, sample.green, sample.blue);
          const saturation = max ? (max - min) / max : 0;
          const usableLight = 1 - Math.min(1, Math.abs(sample.light - .46) / .54);
          const weight = saturation ** 2 * (.15 + usableLight);
          accent[0] += sample.red * weight;
          accent[1] += sample.green * weight;
          accent[2] += sample.blue * weight;
          accentWeight += weight;
          if (saturation >= .18 && sample.light >= .095 && sample.light <= .96) {
            const delta = max - min || 1;
            let hue = max === sample.red
              ? (sample.green - sample.blue) / delta + (sample.green < sample.blue ? 6 : 0)
              : max === sample.green
                ? (sample.blue - sample.red) / delta + 2
                : (sample.red - sample.green) / delta + 4;
            hue *= 60;
            const bucketId = (Math.round(hue / 60) % 6) * 2 + (saturation > .55 ? 1 : 0);
            const bucket = colorBuckets.get(bucketId) ?? { weight: 0, red: 0, green: 0, blue: 0, hue };
            const bucketWeight = saturation ** 2;
            bucket.weight += bucketWeight;
            bucket.red += sample.red * bucketWeight;
            bucket.green += sample.green * bucketWeight;
            bucket.blue += sample.blue * bucketWeight;
            colorBuckets.set(bucketId, bucket);
          }
        }
        const resolvedAccent = accentWeight > 1
          ? accent.map((channel) => Math.round(channel / accentWeight))
          : average.map((channel) => Math.round(channel));
        const rankedColors = [...colorBuckets.values()]
          .filter((entry) => entry.weight > 0)
          .sort((first, second) => second.weight - first.weight)
          .map((entry) => ({
            rgb: [entry.red / entry.weight, entry.green / entry.weight, entry.blue / entry.weight],
            hue: entry.hue,
          }));
        const primary = rankedColors[0]?.rgb ?? resolvedAccent;
        const primaryHue = rankedColors[0]?.hue ?? 0;
        const hueDistance = (first, second) => {
          const distance = Math.abs(first - second) % 360;
          return Math.min(distance, 360 - distance);
        };
        const secondary = rankedColors.find((entry) => hueDistance(entry.hue, primaryHue) > 50)?.rgb
          ?? mixColor(primary, [255, 255, 255], .35);
        const lightAppearance = averageBrightness >= .58;
        const surface = lightAppearance
          ? mixColor(primary, [252, 252, 255], .92)
          : mixColor(primary, [12, 12, 18], .86);
        const text = lightAppearance
          ? mixColor(primary, [16, 24, 40], .82)
          : mixColor(primary, [244, 246, 252], .85);
        let resolvedFocusX = clamp(focusX / focusWeight);
        if (safeArea === "left") resolvedFocusX = Math.max(.64, resolvedFocusX);
        if (safeArea === "right") resolvedFocusX = Math.min(.36, resolvedFocusX);
        return {
          appearance: lightAppearance ? "light" : "dark",
          accent: primary.map((channel) => Math.round(channel)),
          focusX: resolvedFocusX,
          focusY: clamp(focusY / focusWeight),
          aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
          luma: clamp(averageBrightness),
          safeArea,
          palette: {
            accent: hexColor(...primary),
            secondary: hexColor(...secondary),
            surface: hexColor(...surface),
            text: hexColor(...text),
          },
        };
  };

  const decodeBrowserImage = (source) => new Promise((resolve, reject) => {
    if (typeof Image !== "function" || !source) {
      reject(new Error("当前 Codex renderer 无法解码图片"));
      return;
    }
    const image = new Image();
    const timeout = setTimeout(() => reject(new Error("图片解码超时，请重试")), 15000);
    image.onload = () => { clearTimeout(timeout); resolve(image); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error("图片解码失败")); };
    image.src = source;
  });

  const createThemePreview = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 240;
    const context = canvas.getContext?.("2d");
    if (!context || typeof context.drawImage !== "function" || typeof canvas.toDataURL !== "function") {
      throw new Error("当前 Codex renderer 无法生成主题缩略图");
    }
    const sourceWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const sourceHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    const preview = canvas.toDataURL("image/webp", .8);
    if (typeof preview !== "string" || !/^data:image\/(?:webp|png|jpeg);base64,/i.test(preview)) {
      throw new Error("主题缩略图编码失败");
    }
    return preview;
  };

  const prepareUploadedArt = async (source) => {
    const image = await decodeBrowserImage(source);
    return { profile: analyzeDecodedImage(image), previewDataUrl: createThemePreview(image) };
  };

  const analyzeArt = async () => {
    try { return analyzeDecodedImage(await decodeBrowserImage(artUrl)); }
    catch { return defaultProfile; }
  };
  let previewMigrationStarted = false;
  const persistCurrentPreviewIfNeeded = async (analysis) => {
    if (previewMigrationStarted || currentSource !== "saved" || currentTheme.preview ||
        !currentArtDataUrl || !currentTheme.id || !analysis?.palette) return;
    previewMigrationStarted = true;
    try {
      const previewDataUrl = createThemePreview(await decodeBrowserImage(currentArtDataUrl));
      if (window[THEME_REQUEST_KEY]) { previewMigrationStarted = false; return; }
      currentTheme.preview = "pending";
      requestTheme({
        kind: "upgrade-saved-theme",
        themeId: String(currentTheme.id),
        previewDataUrl,
        appearance: analysis.appearance,
        art: {
          focusX: analysis.focusX,
          focusY: analysis.focusY,
          safeArea: analysis.safeArea,
          taskMode: "auto",
        },
        palette: analysis.palette,
      });
    } catch {}
  };

  const detectShellAppearance = () => {
    const root = document.documentElement;
    const body = document.body;
    const classes = `${root?.className || ""} ${body?.className || ""}`
      .toLowerCase()
      .replace(/\bdream-theme-(?:dark|light)\b/g, "");
    if (/\b(dark|electron-dark|theme-dark|appearance-dark)\b/.test(classes)) return "dark";
    if (/\b(light|electron-light|theme-light|appearance-light)\b/.test(classes)) return "light";

    const dataTheme = (
      root?.getAttribute?.("data-theme") ||
      root?.getAttribute?.("data-appearance") ||
      root?.getAttribute?.("data-color-mode") ||
      body?.getAttribute?.("data-theme") ||
      body?.getAttribute?.("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    try {
      const hadSkin = root?.classList?.contains?.("codex-dream-skin");
      const savedSkinClasses = hadSkin
        ? ROOT_CLASSES.filter((className) => root.classList.contains(className))
        : [];
      samplingNativeShell = true;
      if (hadSkin) root.classList.remove(...ROOT_CLASSES);
      try {
        const colorScheme = getComputedStyle(root).colorScheme || "";
        if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
        if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
      } finally {
        if (hadSkin) root.classList.add(...savedSkinClasses);
        observer?.takeRecords?.();
        samplingNativeShell = false;
      }
    } catch {
      samplingNativeShell = false;
    }
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}
    return "light";
  };

  const clearSkinVisuals = () => {
    const root = document.documentElement;
    root?.classList.remove(...ROOT_CLASSES);
    if (root && forcedElectronAppearance) {
      root.classList.remove("electron-light", "electron-dark");
      if (originalElectronAppearance) root.classList.add(`electron-${originalElectronAppearance}`);
    }
    forcedElectronAppearance = null;
    originalElectronAppearance = null;
    for (const property of ROOT_PROPERTIES) root?.style.removeProperty(property);
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll(".dream-task").forEach((node) => node.classList.remove("dream-task"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.querySelectorAll("." + MAIN_SURFACE_CLASS).forEach((node) => node.classList.remove(MAIN_SURFACE_CLASS));
    document.querySelectorAll(`.${HOME_UTILITY_CLASS}`).forEach((node) => node.classList.remove(HOME_UTILITY_CLASS));
    document.getElementById(CHROME_ID)?.remove();
    document.getElementById(POLAROID_ID)?.remove();
  };

  const removeThemeCenter = () => {
    themeCenterDisposers.forEach((dispose) => dispose());
    themeCenterDisposers = [];
    document.getElementById(THEME_CENTER_ID)?.remove();
    themeCenter = null;
  };

  const clearSkinDom = () => {
    clearSkinVisuals();
    document.getElementById(STYLE_ID)?.remove();
    removeThemeCenter();
  };

  const applyProfile = (root) => {
    const focusX = config.focusX ?? profile.focusX;
    const focusY = config.focusY ?? profile.focusY;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
    const focus = focusX < .4 ? "left" : focusX > .6 ? "right" : "center";
    const safeArea = config.safeArea === "auto" ? (profile.safeArea ||
      (focus === "left" ? "right" : focus === "right" ? "left" : "center")) : config.safeArea;
    const taskMode = config.taskMode === "auto"
      ? profile.aspect >= 2.25 ? "banner" : "ambient"
      : config.taskMode;
    const accent = config.accent || `rgb(${profile.accent.join(" ")})`;
    const accentInk = luminance(...profile.accent) > .42 ? "rgb(26 24 28)" : "rgb(250 248 251)";
    if (!originalElectronAppearance) {
      originalElectronAppearance = root.classList.contains("electron-dark") ? "dark"
        : root.classList.contains("electron-light") ? "light" : null;
    }
    const electronAppearance = appearance === "dark" ? "dark" : "light";
    root.classList.toggle("electron-dark", electronAppearance === "dark");
    root.classList.toggle("electron-light", electronAppearance === "light");
    forcedElectronAppearance = electronAppearance;
    root.classList.toggle("dream-theme-light", appearance === "light");
    root.classList.toggle("dream-theme-dark", appearance === "dark");
    root.classList.toggle("dream-art-wide", profile.aspect >= 1.75);
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    for (const value of ["left", "center", "right"]) {
      root.classList.toggle(`dream-focus-${value}`, focus === value);
    }
    for (const value of ["left", "center", "right", "none"]) {
      root.classList.toggle(`dream-safe-${value}`, safeArea === value);
    }
    for (const value of ["ambient", "banner", "off"]) {
      root.classList.toggle(`dream-task-${value}`, taskMode === value);
    }
    root.style.setProperty("--dream-art", artUrl ? `url("${artUrl}")` : "none");
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
    root.style.setProperty("--dream-focus-x", String(focusX));
    root.style.setProperty("--dream-focus-y", String(focusY));
    root.style.setProperty("--dream-accent", accent);
    root.style.setProperty("--dream-accent-ink", accentInk);
    root.style.setProperty("--dream-image-luma", profile.luma.toFixed(3));
    if (config.secondary) root.style.setProperty("--dream-secondary", config.secondary);
    else root.style.removeProperty("--dream-secondary");
    if (config.surface) root.style.setProperty("--dream-surface-base", config.surface);
    else root.style.removeProperty("--dream-surface-base");
    if (config.text) root.style.setProperty("--dream-text-base", config.text);
    else root.style.removeProperty("--dream-text-base");
    if (brandingUrls.logo) root.style.setProperty("--dream-logo", `url("${brandingUrls.logo}")`);
    else root.style.removeProperty("--dream-logo");
    if (brandingUrls.polaroid) root.style.setProperty("--dream-polaroid", `url("${brandingUrls.polaroid}")`);
    else root.style.removeProperty("--dream-polaroid");
    root.classList.toggle("dream-has-logo", Boolean(brandingUrls.logo));
    root.classList.toggle("dream-has-polaroid", showPolaroid && Boolean(brandingUrls.polaroid));
  };

  const currentEntry = () => ({
    id: String(currentTheme.id || "custom"),
    name: String(currentTheme.name || "当前主题"),
    theme: currentTheme,
    artDataUrl: currentArtDataUrl,
    branding,
    source: currentSource,
  });

  const setThemeCenterStatus = (message, kind = "info") => {
    const status = themeCenter?.querySelector?.('[data-dream-role="status"]');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
    status.dataset.state = kind === "success" ? "saved" : kind === "pending" ? "saving" : kind;
  };

  const requestTheme = (request) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window[THEME_REQUEST_KEY] = { schemaVersion: 1, requestId, ...request };
    return requestId;
  };

  const replaceThemeLocally = async (entry) => {
    if (!entry?.artDataUrl) {
      setThemeCenterStatus("该主题将在 watcher 确认后切换", "warning");
      return false;
    }
    if (artUrl) URL.revokeObjectURL(artUrl);
    for (const url of Object.values(brandingUrls)) URL.revokeObjectURL(url);
    currentArtDataUrl = entry.artDataUrl;
    artUrl = toObjectUrl(entry.artDataUrl);
    branding = entry.branding && typeof entry.branding === "object" ? entry.branding : {};
    brandingUrls = Object.fromEntries(Object.entries(branding).map(([key, value]) => [key, toObjectUrl(value)]).filter(([, value]) => value));
    currentTheme = entry.theme && typeof entry.theme === "object" ? entry.theme : {};
    currentSource = typeof entry.source === "string" ? entry.source : "built-in";
    nativeMode = false;
    config = normalizeConfig(currentTheme);
    profile = {
      ...defaultProfile,
      aspect: Number(currentTheme?.artMetadata?.ratio) > 0 ? Number(currentTheme.artMetadata.ratio) : defaultProfile.aspect,
    };
    removeThemeCenter();
    ensure();
    const state = window[STATE_KEY];
    if (state?.installToken === installToken) {
      state.artUrl = artUrl;
      state.brandingUrls = brandingUrls;
      state.config = config;
    }
    analyzeArt().then((result) => {
      const state = window[STATE_KEY];
      if (state?.installToken !== installToken || window.__CODEX_DREAM_SKIN_DISABLED__) return;
      profile = result;
      state.profile = result;
      ensure();
    });
    return true;
  };

  const useNativeModeLocally = () => {
    if (artUrl) URL.revokeObjectURL(artUrl);
    for (const url of Object.values(brandingUrls)) URL.revokeObjectURL(url);
    artUrl = null;
    currentArtDataUrl = "";
    branding = {};
    brandingUrls = {};
    currentTheme = {
      id: NATIVE_THEME_ID,
      name: "不使用主题",
      appearance: "auto",
      nativeMode: true,
    };
    config = normalizeConfig(currentTheme);
    currentSource = "native";
    nativeMode = true;
    removeThemeCenter();
    ensure();
    const state = window[STATE_KEY];
    if (state?.installToken === installToken) {
      state.artUrl = artUrl;
      state.brandingUrls = brandingUrls;
      state.config = config;
    }
  };

  const buildThemeCard = (entry, onPick, onContext, selectedId) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.dreamRole = "theme-option";
    button.dataset.themeId = String(entry.id || entry.theme?.id || "");
    button.dataset.themeSource = String(entry.source || "built-in");
    button.setAttribute("aria-pressed", String(button.dataset.themeId === selectedId));
    button.setAttribute("aria-label", String(entry.name || entry.theme?.name || "主题"));
    button.title = String(entry.name || entry.theme?.name || "主题");
    const preview = document.createElement("span");
    preview.dataset.dreamRole = "theme-preview";
    if (entry.artDataUrl) {
      preview.style.backgroundImage = `url("${entry.artDataUrl}")`;
      const focusX = Number(entry.theme?.art?.focusX);
      const focusY = Number(entry.theme?.art?.focusY);
      preview.style.backgroundPosition = `${Number.isFinite(focusX) ? Math.round(focusX * 100) : 50}% ${Number.isFinite(focusY) ? Math.round(focusY * 100) : 50}%`;
    }
    const copy = document.createElement("span");
    copy.dataset.dreamRole = "theme-copy";
    const name = document.createElement("strong");
    name.textContent = String(entry.name || entry.theme?.name || "主题");
    const meta = document.createElement("small");
    meta.textContent = entry.source === "saved" ? "我的主题" : "内置主题";
    copy.appendChild(name);
    copy.appendChild(meta);
    const check = document.createElement("span");
    check.dataset.dreamRole = "theme-check";
    check.textContent = "✓";
    for (const node of [preview, copy, check]) button.appendChild(node);
    button.addEventListener("click", () => onPick(entry));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onContext(entry, event, button);
    });
    return button;
  };

  const readUploadDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(file.type) || file.size < 1 || file.size > 8 * 1024 * 1024) {
      reject(new Error("请选择 8 MB 以内的 PNG、JPEG 或 WebP 图片"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onabort = () => reject(new Error("图片读取已取消"));
    reader.readAsDataURL(file);
  });

  const ensureThemeCenter = () => {
    if (!document.body || typeof document.createElement !== "function") return;
    if (document.getElementById(THEME_CENTER_ID)) return;
    const root = document.createElement("div");
    root.id = THEME_CENTER_ID;
    root.dataset.dreamRole = "theme-center-root";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.dataset.dreamRole = "theme-trigger";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.title = "打开主题中心";
    const triggerPreview = document.createElement("span");
    triggerPreview.dataset.dreamRole = "trigger-preview";
    triggerPreview.dataset.native = String(nativeMode);
    triggerPreview.style.backgroundImage = currentArtDataUrl ? `url("${currentArtDataUrl}")` : "none";
    const triggerLabel = document.createElement("span");
    triggerLabel.textContent = "主题";
    trigger.appendChild(triggerPreview);
    trigger.appendChild(triggerLabel);
    const backdrop = document.createElement("div");
    backdrop.dataset.dreamRole = "theme-backdrop";
    backdrop.hidden = true;
    const panel = document.createElement("section");
    panel.dataset.dreamRole = "theme-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "主题中心");
    const header = document.createElement("header");
    header.dataset.dreamRole = "theme-header";
    const heading = document.createElement("div");
    const headingTitle = document.createElement("strong");
    headingTitle.textContent = "主题中心";
    const headingSubtitle = document.createElement("small");
    headingSubtitle.textContent = "Codex Dream Skin";
    heading.appendChild(headingTitle);
    heading.appendChild(headingSubtitle);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.dataset.dreamRole = "theme-close";
    closeButton.setAttribute("aria-label", "关闭主题中心");
    closeButton.title = "关闭";
    closeButton.textContent = "×";
    header.appendChild(heading);
    header.appendChild(closeButton);
    const scroll = document.createElement("div");
    scroll.dataset.dreamRole = "theme-scroll";
    const currentHero = document.createElement("div");
    currentHero.dataset.dreamRole = "current-theme-hero";
    currentHero.dataset.native = String(nativeMode);
    currentHero.style.backgroundImage = currentArtDataUrl
      ? `linear-gradient(90deg, rgba(17,35,47,.68), rgba(17,35,47,.08)), url("${currentArtDataUrl}")`
      : "linear-gradient(135deg, rgba(23,174,182,.2), rgba(238,108,187,.14))";
    currentHero.style.backgroundPosition = "center";
    const currentCopy = document.createElement("div");
    const currentEyebrow = document.createElement("small");
    currentEyebrow.textContent = "当前主题";
    const currentName = document.createElement("strong");
    currentName.textContent = String(currentTheme.name || "Codex Dream Skin");
    currentCopy.appendChild(currentEyebrow);
    currentCopy.appendChild(currentName);
    currentHero.appendChild(currentCopy);
    const quickActions = document.createElement("div");
    quickActions.dataset.dreamRole = "quick-actions";
    const upload = document.createElement("button");
    upload.type = "button";
    upload.dataset.dreamRole = "upload";
    upload.textContent = "＋ 自定义图片";
    const nativeButton = document.createElement("button");
    nativeButton.type = "button";
    nativeButton.dataset.dreamRole = "native-mode";
    nativeButton.setAttribute("aria-pressed", String(nativeMode));
    nativeButton.textContent = "不使用主题";
    quickActions.appendChild(upload);
    quickActions.appendChild(nativeButton);
    const builtInHeading = document.createElement("h3");
    builtInHeading.dataset.dreamRole = "section-heading";
    builtInHeading.textContent = "内置主题";
    const savedSection = document.createElement("section");
    savedSection.dataset.dreamRole = "saved-theme-section";
    const savedHeading = document.createElement("h3");
    savedHeading.dataset.dreamRole = "section-heading";
    savedHeading.textContent = "我的主题";
    const savedGrid = document.createElement("div");
    savedGrid.dataset.dreamRole = "saved-theme-grid";
    savedSection.appendChild(savedHeading);
    savedSection.appendChild(savedGrid);
    const grid = document.createElement("div");
    grid.dataset.dreamRole = "theme-grid";
    for (const node of [currentHero, quickActions, savedSection, builtInHeading, grid]) scroll.appendChild(node);
    const footer = document.createElement("footer");
    footer.dataset.dreamRole = "theme-footer";
    const polaroidControl = document.createElement("div");
    polaroidControl.dataset.dreamRole = "polaroid-control";
    const polaroidLabel = document.createElement("span");
    const polaroidAvailable = Boolean(branding.polaroid);
    polaroidControl.dataset.available = String(polaroidAvailable);
    polaroidLabel.textContent = polaroidAvailable ? "展示拍立得" : "当前主题无拍立得";
    const polaroidToggle = document.createElement("button");
    polaroidToggle.type = "button";
    polaroidToggle.dataset.dreamRole = "polaroid-toggle";
    polaroidToggle.setAttribute("role", "switch");
    polaroidToggle.setAttribute("aria-checked", String(showPolaroid && polaroidAvailable));
    polaroidToggle.setAttribute("aria-label", "展示拍立得");
    polaroidToggle.disabled = !polaroidAvailable;
    const polaroidUpload = document.createElement("button");
    polaroidUpload.type = "button";
    polaroidUpload.dataset.dreamRole = "polaroid-upload";
    polaroidUpload.textContent = polaroidAvailable ? "更换" : "添加";
    polaroidUpload.hidden = currentSource !== "saved";
    const polaroidKnob = document.createElement("span");
    polaroidKnob.dataset.dreamRole = "polaroid-toggle-knob";
    polaroidKnob.setAttribute("aria-hidden", "true");
    polaroidToggle.appendChild(polaroidKnob);
    polaroidControl.appendChild(polaroidLabel);
    polaroidControl.appendChild(polaroidToggle);
    polaroidControl.appendChild(polaroidUpload);
    const status = document.createElement("div");
    status.dataset.dreamRole = "status";
    status.dataset.state = "saved";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "已保存";
    footer.appendChild(polaroidControl);
    footer.appendChild(status);
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/png,image/jpeg,image/webp";
    picker.hidden = true;
    const polaroidPicker = document.createElement("input");
    polaroidPicker.type = "file";
    polaroidPicker.accept = "image/png,image/jpeg,image/webp";
    polaroidPicker.hidden = true;
    const contextMenu = document.createElement("div");
    contextMenu.dataset.dreamRole = "theme-context-menu";
    contextMenu.setAttribute("role", "menu");
    contextMenu.setAttribute("aria-label", "主题操作");
    contextMenu.hidden = true;
    const deleteThemeButton = document.createElement("button");
    deleteThemeButton.type = "button";
    deleteThemeButton.dataset.dreamRole = "delete-theme";
    deleteThemeButton.setAttribute("role", "menuitem");
    contextMenu.appendChild(deleteThemeButton);
    for (const node of [header, scroll, footer]) panel.appendChild(node);
    backdrop.appendChild(panel);
    root.appendChild(trigger);
    root.appendChild(backdrop);
    root.appendChild(picker);
    root.appendChild(polaroidPicker);
    root.appendChild(contextMenu);
    document.body.appendChild(root);
    themeCenter = root;
    themeCenterDisposers = [];
    let contextEntry = null;
    let deleteConfirmTimer = null;
    const closeContextMenu = () => {
      contextMenu.hidden = true;
      contextEntry = null;
      deleteThemeButton.dataset.confirmed = "false";
      if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
      deleteConfirmTimer = null;
    };
    const close = () => {
      closeContextMenu();
      backdrop.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    const open = () => { backdrop.hidden = false; trigger.setAttribute("aria-expanded", "true"); closeButton.focus?.(); };
    const openContextMenu = (entry, event, anchor) => {
      closeContextMenu();
      contextEntry = entry;
      const deletable = entry.id !== NATIVE_THEME_ID &&
        ["saved", "active", "default", "built-in"].includes(entry.source);
      deleteThemeButton.disabled = !deletable;
      deleteThemeButton.dataset.destructive = String(deletable);
      deleteThemeButton.textContent = deletable ? "删除主题" : "该主题不可删除";
      contextMenu.hidden = false;
      const anchorRect = anchor.getBoundingClientRect?.() ?? { left: event.clientX, bottom: event.clientY };
      const width = contextMenu.offsetWidth || 176;
      const height = contextMenu.offsetHeight || 42;
      const x = Math.min(Math.max(8, event.clientX || anchorRect.left), Math.max(8, window.innerWidth - width - 8));
      const y = Math.min(Math.max(8, event.clientY || anchorRect.bottom), Math.max(8, window.innerHeight - height - 8));
      contextMenu.style.left = `${Math.round(x)}px`;
      contextMenu.style.top = `${Math.round(y)}px`;
      deleteThemeButton.focus?.();
    };
    trigger.addEventListener("click", () => {
      if (backdrop.hidden) open();
      else close();
    });
    closeButton.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    panel.addEventListener("click", (event) => event.stopPropagation());
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (!contextMenu.hidden) { closeContextMenu(); return; }
      if (!backdrop.hidden) { close(); trigger.focus?.(); }
    };
    const onPointerDown = (event) => {
      if (!contextMenu.hidden && !contextMenu.contains?.(event.target)) closeContextMenu();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    upload.addEventListener("click", () => picker.click());
    nativeButton.addEventListener("click", () => {
      if (nativeMode) { close(); return; }
      requestTheme({ kind: "native-mode" });
      close();
      useNativeModeLocally();
      setThemeCenterStatus("正在由 watcher 保存原生模式…", "pending");
    });
    const paintPolaroidToggle = () => {
      polaroidToggle.setAttribute("aria-checked", String(showPolaroid && polaroidAvailable));
    };
    const togglePolaroid = () => {
      if (!polaroidAvailable) return;
      showPolaroid = !showPolaroid;
      paintPolaroidToggle();
      ensure();
      requestTheme({ kind: "set-polaroid-visibility", visible: showPolaroid });
      setThemeCenterStatus(showPolaroid ? "正在由 watcher 显示拍立得…" : "正在由 watcher 隐藏拍立得…", "pending");
    };
    polaroidToggle.addEventListener("click", togglePolaroid);
    polaroidToggle.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      togglePolaroid();
    });
    polaroidUpload.addEventListener("click", () => polaroidPicker.click());
    polaroidPicker.addEventListener("change", () => {
      const file = polaroidPicker.files?.[0];
      polaroidPicker.value = "";
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        setThemeCenterStatus("拍立得图片不能超过 4 MB", "error");
        return;
      }
      void readUploadDataUrl(file).then(async (dataUrl) => {
        const themeId = String(currentTheme.id || "");
        if (currentSource !== "saved" || !themeId) throw new Error("只有“我的主题”可以添加拍立得");
        const entry = {
          ...currentEntry(),
          branding: { ...branding, polaroid: dataUrl },
        };
        await replaceThemeLocally(entry);
        requestTheme({ kind: "set-theme-polaroid", themeId, imageDataUrl: dataUrl });
        setThemeCenterStatus("正在由 watcher 保存该主题的拍立得…", "pending");
        close();
      }).catch((error) => setThemeCenterStatus(error.message, "error"));
    });
    deleteThemeButton.addEventListener("click", () => {
      if (!contextEntry || contextEntry.id === NATIVE_THEME_ID ||
          !["saved", "active", "default", "built-in"].includes(contextEntry.source)) return;
      if (deleteThemeButton.dataset.confirmed !== "true") {
        deleteThemeButton.dataset.confirmed = "true";
        deleteThemeButton.textContent = "再次点击确认删除";
        deleteConfirmTimer = setTimeout(() => {
          deleteThemeButton.dataset.confirmed = "false";
          deleteThemeButton.textContent = "删除主题";
          deleteConfirmTimer = null;
        }, 2600);
        return;
      }
      const deletedName = String(contextEntry.name || contextEntry.theme?.name || "该主题");
      requestTheme({ kind: "delete-theme", themeId: String(contextEntry.id) });
      closeContextMenu();
      setThemeCenterStatus(`正在由 watcher 删除“${deletedName}”…`, "pending");
    });
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (!file) return;
      void readUploadDataUrl(file).then(async (dataUrl) => {
        setThemeCenterStatus("正在分析图片颜色和明暗外观…", "pending");
        const prepared = await prepareUploadedArt(dataUrl);
        const pendingId = `custom-pending-${Date.now().toString(36)}`;
        const entry = {
          id: pendingId,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "自定义图片",
          theme: {
            id: pendingId,
            name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "自定义图片",
            appearance: prepared.profile.appearance,
            art: {
              focusX: prepared.profile.focusX,
              focusY: prepared.profile.focusY,
              safeArea: prepared.profile.safeArea,
              taskMode: "auto",
            },
            palette: prepared.profile.palette,
            branding: {},
          },
          artDataUrl: dataUrl,
          branding: {},
          source: "saved",
        };
        await replaceThemeLocally(entry);
        requestTheme({
          kind: "custom-image",
          name: entry.name,
          imageDataUrl: dataUrl,
          previewDataUrl: prepared.previewDataUrl,
          appearance: prepared.profile.appearance,
          art: entry.theme.art,
          palette: prepared.profile.palette,
        });
        setThemeCenterStatus("已自动取色，正在由 watcher 保存主题…", "pending");
        close();
      }).catch((error) => setThemeCenterStatus(error.message, "error"));
    });
    const entries = nativeMode
      ? [...catalog]
      : [currentEntry(), ...catalog.filter((entry) => entry.id !== currentTheme.id)];
    for (const entry of entries) {
      const targetGrid = entry.source === "saved" ? savedGrid : grid;
      targetGrid.appendChild(buildThemeCard(entry, async (picked) => {
        if (picked.id === currentTheme.id) { close(); return; }
        close();
        const applied = await replaceThemeLocally(picked);
        if (!applied) setThemeCenterStatus("正在由 watcher 加载该主题…", "pending");
        requestTheme({ kind: "select-theme", themeId: String(picked.id) });
        setThemeCenterStatus("正在由 watcher 保存选择…", "pending");
      }, openContextMenu, String(currentTheme.id || "")));
    }
    savedSection.hidden = savedGrid.children.length === 0;
    themeCenterDisposers.push(() => {
      close();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    });
  };

  const refreshThemeAck = () => {
    const ack = window[THEME_ACK_KEY];
    if (!ack || typeof ack !== "object") return;
    if (ack.status === "error") setThemeCenterStatus(String(ack.message || "主题保存失败"), "error");
    else if (ack.status === "accepted") setThemeCenterStatus("已由 watcher 保存", "success");
    delete window[THEME_ACK_KEY];
  };

  const ensure = () => {
    if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
    const root = document.documentElement;
    if (!root || !document.body) return;

    const shellMain = document.querySelector("main." + MAIN_SURFACE_CLASS) ?? document.querySelector("main");
    if (!shellMain) {
      clearSkinDom();
      return;
    }
    shellMain.classList.add(MAIN_SURFACE_CLASS);

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.dreamVersion !== "5") {
      style.textContent = cssText;
      style.dataset.dreamVersion = "5";
    }

    if (nativeMode) {
      clearSkinVisuals();
      ensureThemeCenter();
      return;
    }

    root.classList.add("codex-dream-skin");
    applyProfile(root);

    const homeMarker = shellMain.querySelector?.(
      '[data-testid="home-icon"], [data-feature="game-source"], .group\\/home-suggestions',
    ) ?? document.querySelector(
      'main.dream-main-surface [data-testid="home-icon"], main.dream-main-surface [data-feature="game-source"], main.dream-main-surface .group\\/home-suggestions',
    );
    const roleHome = document.querySelector('[role="main"]:has([data-testid="home-icon"], [data-feature="game-source"], .group\\/home-suggestions)');
    const home = roleHome ?? homeMarker?.closest?.('[role="main"]') ?? null;
    for (const candidate of document.querySelectorAll('[role="main"]')) {
      candidate.classList.toggle("dream-home", Boolean(homeMarker) && candidate === home);
      candidate.classList.toggle("dream-task", !homeMarker);
    }
    const utilityBars = new Set(homeMarker ? shellMain.querySelectorAll('[class*="_homeUtilityBar_"]') : []);
    for (const candidate of document.querySelectorAll(`.${HOME_UTILITY_CLASS}`)) {
      if (!utilityBars.has(candidate)) candidate.classList.remove(HOME_UTILITY_CLASS);
    }
    for (const candidate of utilityBars) candidate.classList.add(HOME_UTILITY_CLASS);
    shellMain.classList.toggle("dream-home-shell", Boolean(homeMarker));

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      document.body.appendChild(chrome);
    }
    chrome.classList.toggle("dream-home-shell", Boolean(homeMarker));
    ensureThemeCenter();
    const polaroid = document.getElementById(POLAROID_ID);
    if (showPolaroid && brandingUrls.polaroid) {
      const node = polaroid || document.createElement("div");
      node.id = POLAROID_ID;
      node.dataset.dreamRole = "polaroid";
      node.style.backgroundImage = `url("${brandingUrls.polaroid}")`;
      if (!node.parentElement) document.body.appendChild(node);
    } else polaroid?.remove();
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    clearSkinDom();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.ackTimer) clearInterval(state.ackTimer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    for (const url of Object.values(state?.brandingUrls ?? {})) URL.revokeObjectURL(url);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  observer = new MutationObserver(() => {
    if (samplingNativeShell) return;
    scheduleEnsure();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode"],
  });
  const timer = setInterval(ensure, 5000);
  const ackTimer = setInterval(refreshThemeAck, 300);
  window[STATE_KEY] = {
    ensure, cleanup, disposeThemeCenter: removeThemeCenter, observer, timer, ackTimer, scheduler,
    artUrl, brandingUrls, profile, config, installToken, version: "1.4.3",
  };
  ensure();
  analyzeArt().then((result) => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken || window.__CODEX_DREAM_SKIN_DISABLED__) return;
    profile = result;
    state.profile = result;
    ensure();
    void persistCurrentPreviewIfNeeded(result);
  });
  return { installed: true, version: "1.4.3", adaptive: true };
})(__DREAM_CSS_JSON__, __DREAM_ART_JSON__, __DREAM_THEME_JSON__, __DREAM_BRANDING_JSON__, __DREAM_CATALOG_JSON__, __DREAM_CURRENT_SOURCE_JSON__, __DREAM_UI_PREFERENCES_JSON__)
