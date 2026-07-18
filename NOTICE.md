# 软件许可、视觉素材与商标

本仓库是非官方项目，与 OpenAI、Crypton Future Media、miHoYo/HoYoverse、Kuro Games、Shueisha、Papergames 及其合作方不存在隶属、认可或背书关系。

MIT License 只覆盖本仓库的软件代码，不自动覆盖图片、角色设计、人物肖像、商标、截图或其他第三方内容。本仓库维护者没有这些视觉素材的完整版权或可核实的再分发授权。免责声明、“仅供学习”、“非商业用途”、“粉丝作品”、“来自网络”或“AI 生成”等表述不会产生授权，也不能替代原作者、肖像权人或商标权人的许可。

视觉素材的逐项来源和已知授权状态见 [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md)。部分文件缺少完整来源记录，公开打包、Release 和再次分发仍有权利风险；仓库公开可见不代表对这些素材拥有权利，也不构成法律判断。使用者在复制、修改或再次分发前，应自行取得所需权利，无法确认时应替换或删除相关文件。

Hatsune Miku（初音未来）、Genshin Impact（原神）、Wuthering Waves（鸣潮）、Naruto（火影忍者）、Love and Deepspace（恋与深空）及相关名称、角色设计和标识归各自权利人所有。提及这些名称只用于描述现有预设，不表示获得许可。

## English summary

Windows Skin for Codex is an unofficial customization project. OpenAI, Crypton Future Media, miHoYo/HoYoverse, Kuro Games, Shueisha, Papergames and their partners do not sponsor or endorse it.

The MIT License covers software source code in this repository. It does not grant permission to copy or redistribute third-party artwork, screenshots, character designs, likenesses, names, logos or other trademarks.

Hatsune Miku, Genshin Impact, Wuthering Waves, Naruto, Love and Deepspace and their related character designs belong to their respective rights holders. Their names identify bundled fan presets; they do not imply permission or approval.

Several theme images came from the public HeiGe repository, whose owner recorded a decision to publish them with version 5.2.1 despite incomplete source and license records. That decision is not a third-party license. This repository's maintainer has no verified redistribution license for those files. Anyone uploading, forking or releasing this repository must review [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md), obtain the required permission, or replace the files.

The Arina Hashimoto reference wallpaper came from the Fei repository and is also excluded from the software license. Its inclusion does not imply participation, approval or a right to commercial redistribution.

This repository does not contain OpenAI application binaries or an official Codex icon file. During installation, the script copies an `.ico` resource from the user's locally installed and registered `OpenAI.Codex` package into `%LOCALAPPDATA%\CodexDreamSkin\codex.ico` for the user's shortcut.

Themes use Chromium DevTools Protocol on `127.0.0.1`. A local debugging port deserves the same care as any other local control interface: do not run untrusted software while the themed session is open. Use `restore.bat` to remove the injected UI and close the managed CDP session.
