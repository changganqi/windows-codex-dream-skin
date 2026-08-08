# Changelog

## 1.0.8 - 2026-08-08

- Disabled backdrop sampling on the sidebar, composer, user bubbles, and approval surfaces, adopting HeiGe 5.4.12's high-frequency rendering optimization while preserving the migrated visual palette.
- Split renderer observation into root appearance attributes and structural child changes so hover and streaming class mutations no longer schedule full skin reconciliation.
- Replaced the 300 ms theme-acknowledgement poll with an explicit renderer event and reduced the fallback full-DOM safety pass from 5 seconds to 30 seconds.
- Kept Fei's existing watcher audit throttling, target failure backoff, CDP list retry backoff, and no-focus-stealing status behavior unchanged.

## 1.0.7 - 2026-08-08

- Restored startup on Codex Store 26.803 builds by verifying plugin-owned renderer contracts instead of requiring Codex's optional composer and suggestion-card DOM.
- Coalesced repeated desktop-shortcut clicks immediately so they cannot queue another restart behind an in-progress launch.
- Preserved a live watcher and Codex session when the skin core is rendered but an auxiliary renderer check remains inconclusive.
- Added regression coverage for the 26.803 home renderer shape with no initial composer or suggestion cards.
- Removed a wall-clock threshold from the native TCP ownership regression so transient GitHub-hosted runner load cannot fail an otherwise correct PowerShell 7 build.
- Updated the CI checkout and Node setup actions to their Node 24-based v5 releases.

## 1.0.6 - 2026-08-03

- Restored startup on Codex Store 26.727 builds after the native main surface moved from the legacy `main-surface` class to a versioned CSS Modules class.
- Added the plugin-owned `dream-main-surface` contract so renderer styling, lifecycle cleanup, one-shot commands, and verification no longer depend on Codex's private main-surface class name.
- Kept auxiliary `initialRoute` windows excluded while using the semantic primary-route `<main>` element for forward-compatible discovery.

## 1.0.5 - 2026-07-30

- Kept the active skin, theme center, and palette mounted when Codex removes the left-sidebar DOM while the sidebar is collapsed.
- Allowed the watcher and startup verifier to recognize the primary Codex renderer without requiring a visible sidebar, while continuing to exclude auxiliary `initialRoute` windows.
- Applied the selected theme accent to title-bar action icons in both light and dark appearances.

## 1.0.4 - 2026-07-27

- Restored the native new-task layout after Codex changed its private home-page nesting; the gray Codex home icon remains hidden without structural `first-child` selectors.
- Updated startup verification to use the stable home-shell state, preventing a successful injection from being rolled back when newer Codex builds omit the old nested hero wrapper.
- Made every uploaded image a separate durable theme under `%LOCALAPPDATA%\CodexDreamSkin\themes`, with an atomically stored artwork file and compact persistent preview.
- Added HeiGe-style automatic palette extraction, light/dark appearance selection, focus point, and safe-area metadata for uploaded themes.
- Stopped custom themes from inheriting another theme's logo or polaroid, and migrated the legacy `custom-upload` slot away from copied Miku branding.
- Disabled the polaroid switch when the current theme has no polaroid and added per-theme add/replace support for saved themes.

## 1.0.3 - 2026-07-19

- Replaced the slow `Get-NetTCPConnection` CDP ownership probe with the native Windows IP Helper API for fast IPv4/IPv6 listener validation.
- Added per-stage launch timing, unique launch IDs, an atomic latest `launch.log`, and append-only `launch-history.log` diagnostics.
- Made an already healthy shortcut launch idempotent so repeated clicks no longer restart the watcher.
- Extended the bounded cold CDP wait to 90 seconds without allowing slow probes to turn it into a multi-minute pseudo-timeout.
- Hardened reinstall by stopping the recorded watcher before atomically replacing `%LOCALAPPDATA%\CodexDreamSkin\engine`.
- Clarified portable ZIP installation and kept `install.bat` open on failure so the actual error remains visible.

## 1.0.2 - 2026-07-18

- Added a watcher-persisted native Codex mode that keeps the theme-center entry available.
- Added a right-click theme menu: custom themes are deleted from managed storage, while built-ins use an upgrade-safe persisted hidden-theme list.
- Added dark-theme contrast coverage for native menus, tooltips, composer overlays, section headers, summary panels, header controls and progress pills.
- Mapped model/reasoning status text and header action icons to each theme's accent color while keeping theme-center submenus light.
- Added strict request-schema, managed-path deletion and native-mode renderer regression coverage.
- Restored the theme-center footer control as a watcher-persisted “展示拍立得” toggle; dark task-surface secondary cards now inherit the active dark palette.

## 1.0.1 - 2026-07-18

- Replaced the PowerShell desktop shortcut target with a hidden VBScript launcher.
- Extended cold renderer verification from 30 seconds to 120 seconds.
- Replaced the PowerShell 7-only process timeout with a bounded Windows PowerShell 5.1 polling loop.
- Added separate Codex-only, visible diagnostic and hidden combined launch entries.

## 1.0.0 - 2026-07-18

- Combined Fei's Windows Store/MSIX launch and watcher path with HeiGe's theme center and built-in themes.
- Added strict watcher-owned theme persistence and custom-image requests.
- Added the optional Miku Future pet installer without coupling it to skin installation.
- Added a stable `Codex.lnk` launcher with an official icon cache that refreshes after Store package updates.
- Added Windows PowerShell 5.1, PowerShell 7 and Node.js regression coverage.
