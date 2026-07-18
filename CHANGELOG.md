# Changelog

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
