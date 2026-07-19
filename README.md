# Windows Skin for Codex

这是一个专门适配 Windows 10/11 和 Microsoft Store 版 `OpenAI.Codex` 的非官方桌面皮肤项目。项目重点解决 Store/MSIX 应用在发现、带 CDP 参数启动、版本升级、隐藏控制台和失败恢复方面的问题；Miku 与其他视觉内容作为可切换的内置主题提供。它不修改 `app.asar`、应用签名或 WindowsApps 里的 Codex 文件。

## 上游来源与分工

本项目在下面两个仓库的公开代码和资源基础上修改，并保留了各自擅长的部分：

- [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin)：提供 Windows 启动链路、Microsoft Store/MSIX 发现、CDP 注入、watcher、状态恢复和回滚基础。
- [HeiGeAi/heige-codex-skin-studio](https://github.com/HeiGeAi/heige-codex-skin-studio)：提供主题中心 UI、Miku 视觉资源、其他内置主题和可选的 Miku Future 宠物。

运行时仍由 Fei watcher 负责，HeiGe 的旧后台控制器、计划任务和“皮肤常驻”机制没有带进来。视觉资源的来源与再分发状态单独记录在 [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md)，第三方代码说明见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

## Windows 版的重点

- 通过 `Get-AppxPackage OpenAI.Codex` 查找当前注册的 Store/MSIX 版本，再用系统包激活接口传入 CDP 参数；Codex 更新后不用手改版本化的 `WindowsApps\OpenAI.Codex_*` 路径。
- 启动器会避开 WindowsApps 中受限制的打包辅助程序，并选择可用的系统 Node.js。支持 Node.js 22 及以上版本。
- 安装器创建带官方 Codex 图标的桌面和开始菜单快捷方式，日常启动走隐藏的 VBScript 入口，不留下 PowerShell 黑框。
- watcher 持久保存主题、原生模式、隐藏主题清单和拍立得开关；切换主题不需要安装 HeiGe 的常驻控制器。
- 引擎更新采用临时目录验证和原子替换，失败时保留上一版；`restore.bat` 可以恢复原生界面。Windows PowerShell 5.1、PowerShell 7 和 Node 测试都放在仓库里。

## 界面预览

Miku 主题应用后的 Codex 主页：

![Miku Windows Skin for Codex 主页预览](docs/images/windows-skin-preview.png)

任务工作区与输出面板：

![Miku Windows Skin for Codex 任务工作区预览](docs/images/windows-skin-preview2.png)

## 现在有什么

- HeiGe 风格主题中心，顶部圆形按钮可直接切换主题或导入图片。
- 主题选择写入 `%LOCALAPPDATA%\CodexDreamSkin\selected-theme.json`，由 Fei watcher 在页面重载后重新注入。
- 主题中心底部的“展示拍立得”按钮只控制右下角 Miku 拍立得卡片；状态由 watcher 写入 `%LOCALAPPDATA%\CodexDreamSkin\ui-preferences.json`，切换主题、重启 Codex 和升级引擎都会保留。
- 桌面主入口叫 `Codex.lnk`，使用官方 Codex 图标，并通过 `wscript.exe` 隐藏控制台。图标缓存位于 `%LOCALAPPDATA%\CodexDreamSkin\codex.ico`。
- Miku Future 宠物单独安装。换肤不会偷偷改宠物设置。

## 系统要求

- Windows 10 或 Windows 11
- Microsoft Store 安装的官方 Codex Desktop
- Node.js 22 或更高版本，建议使用当前 LTS 或 Node.js 24
- 当前用户可以读取已注册的 `OpenAI.Codex` MSIX 包

项目不修改 `app.asar`、应用签名或 Codex 二进制文件。调试端口只监听 `127.0.0.1`。

## 安装

先彻底退出 Codex，包括系统托盘里的后台进程，然后双击根目录的 `install.bat`。

也可以在 PowerShell 中运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

安装过程把运行代码原子复制到：

```text
%LOCALAPPDATA%\CodexDreamSkin\engine
```

它会在桌面和开始菜单创建 `Codex.lnk`。该快捷方式同时启动 Codex 和 Fei watcher，不显示 PowerShell 黑框；直接打开 Store 原入口不会携带 CDP 参数，皮肤也就无法注入。

## 日常使用

打开桌面的 `Codex`。如果官方 Codex 已经在无调试端口的状态下运行，这个“Codex + skin”入口会正常重启一次应用；隐藏启动的输出写入 `%LOCALAPPDATA%\CodexDreamSkin\launch.log`，失败时才弹出提示。

进入 Codex 后，点击顶部 Miku 圆形按钮打开主题中心。选中的主题由 watcher 保存，不需要点击 HeiGe 的“皮肤常驻”。自定义背景图也从这个面板导入。点击“不使用主题”可持久切回 Codex 原生界面，同时保留顶部主题中心入口；右键主题卡片可二次确认删除。“我的主题”会从受管目录删除，内置主题则写入升级安全的隐藏清单，不修改发布文件。

Store 更新 Codex 后仍使用同一个桌面快捷方式。启动器每次都通过 `Get-AppxPackage OpenAI.Codex` 选择当前注册的最高版本，并刷新固定路径下的官方图标；代码里没有写死 `WindowsApps\OpenAI.Codex_26.x...` 目录。

刚启动时可能短暂显示默认主题，等页面和 CDP 准备完成后才会出现皮肤。这是当前注入方式的启动顺序，不代表主题丢失。

项目根目录还保留了几个明确入口：

- `start-codex-only.bat`：只启动官方 Codex，不启动皮肤。
- `start-codex-with-skin.bat`：同时启动 Codex 和皮肤，保留命令窗口，适合看启动输出或排错。
- `start-codex-with-skin.vbs`：同时启动 Codex 和皮肤，不显示黑框。桌面快捷方式采用同一套隐藏启动逻辑。

## Miku Future 宠物

宠物是可选项。需要时双击：

```text
install-miku-future.bat
```

脚本只把宠物安装到 `%USERPROFILE%\.codex\pets\miku-future`，并更新 `config.toml` 的头像选择；它不会创建后台控制器。

## 检查与恢复

只读检查：

```text
verify.bat
```

恢复原生界面并关闭当前皮肤会话：

```text
restore.bat
```

恢复可能需要正常重启 Codex，脚本会先询问。状态和日志位于 `%LOCALAPPDATA%\CodexDreamSkin`。

## 更新本仓库

拉取新代码后，彻底退出 Codex 和皮肤托盘，再运行一次 `install.bat`。安装器先验证完整运行目录，随后替换旧 engine；失败时保留旧版本，不会留下半套文件。

## 测试

```powershell
$tests = Get-ChildItem .\windows\tests\*.test.mjs
node --test $tests.FullName
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\tests\run-tests.ps1
```

GitHub Actions 同时运行 Windows PowerShell 5.1 和 PowerShell 7 测试。

## 许可证与素材

代码使用 [MIT License](LICENSE)。该许可只覆盖软件代码，不授权主题图片、角色设计、人物肖像、截图、商标或其他第三方内容。官方 Codex 图标只在安装时从用户本机已注册的 Store 包中提取，本仓库不分发该图标文件。

**素材风险提示**：本仓库维护者没有随仓库提供的角色、人物及主题图片的完整版权或可核实的再分发授权。免责声明、“仅供学习”、“非商业用途”、“粉丝作品”、“来自网络”或“AI 生成”等表述不会产生授权，也不能替代原作者、肖像权人或商标权人的许可。复制、Fork、打包 Release 或再次分发前，请自行取得所需权利，无法确认时应替换或删除相关素材。

逐文件来源和已知授权状态见 [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md)，发布边界见 [NOTICE.md](NOTICE.md)。本项目是非官方项目，与 OpenAI、Crypton Future Media、miHoYo/HoYoverse、Kuro Games、Shueisha、Papergames 及其合作方不存在隶属、认可或背书关系。
