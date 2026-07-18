# Software, artwork and trademarks

Miku Skin for Codex is an unofficial customization project. OpenAI, Crypton Future Media, miHoYo/HoYoverse, Kuro Games, Shueisha, Papergames and their partners do not sponsor or endorse it.

The MIT License covers software source code in this repository. It does not grant permission to copy or redistribute third-party artwork, screenshots, character designs, likenesses, names, logos or other trademarks.

Hatsune Miku, Genshin Impact, Wuthering Waves, Naruto, Love and Deepspace and their related character designs belong to their respective rights holders. Their names identify bundled fan presets; they do not imply permission or approval.

Several theme images came from the public HeiGe repository, whose owner recorded a decision to publish them with version 5.2.1 despite incomplete source and license records. That decision is not a third-party license. Anyone uploading, forking or releasing this repository must review [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md) and decide whether to replace those files.

The Arina Hashimoto reference wallpaper came from the Fei repository and is also excluded from the software license. Its inclusion does not imply participation, approval or a right to commercial redistribution.

This repository does not contain OpenAI application binaries or an official Codex icon file. During installation, the script copies an `.ico` resource from the user's locally installed and registered `OpenAI.Codex` package into `%LOCALAPPDATA%\CodexDreamSkin\codex.ico` for the user's shortcut.

Themes use Chromium DevTools Protocol on `127.0.0.1`. A local debugging port deserves the same care as any other local control interface: do not run untrusted software while the themed session is open. Use `restore.bat` to remove the injected UI and close the managed CDP session.
