# MeetingCopilot v0.2.0-beta.1

首个提供 Windows 安装包的版本 · The first release with a Windows installer

> ⚠️ Beta：安装包**未做代码签名**，Windows 会弹安全提醒；请只从本项目的 Releases 页面下载。
> ⚠️ Beta: the installers are **not code-signed**, so Windows will warn you. Download only from this project's Releases page.

---

## 中文

### 下载哪个

| 文件 | 类型 | 适合 |
|---|---|---|
| `MeetingCopilot-0.2.0-beta.1-win-x64.exe` | 安装版（NSIS，当前用户，无需管理员） | 常规使用。带开始菜单与桌面快捷方式，升级时原地覆盖 |
| `MeetingCopilot-0.2.0-beta.1-win-x64-portable.exe` | 免安装版 | 不想安装、临时使用。首次启动需解压，比安装版慢几秒 |

两者功能完全一致。免安装版**不是完全绿色**：设置和会话仍写在 `%APPDATA%\MeetingCopilot\`，与安装版共用。需要数据也随身携带时，启动前设置环境变量 `MC_USERDATA` 指向自己的目录。

macOS 本次**没有**提供安装包，可以从源码运行，见 [INSTALL_MACOS.en.md](INSTALL_MACOS.en.md)。

### 校验下载（SHA256）

每个 `.exe` 旁边都有同名的 `.exe.sha256` 文件，内容是 CI 构建时算出的哈希。下载后在 PowerShell 里执行：

```powershell
Get-FileHash .\MeetingCopilot-0.2.0-beta.1-win-x64.exe -Algorithm SHA256
```

把输出与 `.sha256` 文件里的值比对，一致再运行。

<!-- 发布时把 CI 产出的两行哈希粘到这里：
MeetingCopilot-0.2.0-beta.1-win-x64.exe            <sha256>
MeetingCopilot-0.2.0-beta.1-win-x64-portable.exe   <sha256>
-->

### 首次使用四步

1. **安装并启动**。SmartScreen 提示「已保护你的电脑」时，确认来源后点「更多信息」→「仍要运行」。
2. **跟着配置向导走**（欢迎 → 选择方案 → 配置服务 → 连接测试 → 完成）。推荐方案是「阿里云百炼实时识别 + DeepSeek 回答」，需要两个自己申请的 API Key；只想注册一个平台就选「极简配置」（MiMo，Beta）。Key 怎么领见 [API_KEYS.zh-CN.md](API_KEYS.zh-CN.md)。
3. **验证声音**。向导第 4 步会让你播放任意有声内容并看音量条，确认应用真的能听到电脑声音。
4. **开始转写**。回到主界面，播放会议或视频，点标题栏 **▶ 开始**；在对方那句上点 **⚡答** 生成可照着念的回答，或打开「持续答」自动接话。

完整走查见 [QUICK_START.zh-CN.md](QUICK_START.zh-CN.md)。

### 这个版本新增了什么

- **Windows 安装包**：NSIS 安装版 + 免安装版，附 SHA256 校验文件；升级和卸载都不会删除 `%APPDATA%\MeetingCopilot\` 里的数据。
- **首次运行配置向导**：五步完成 BYOK 配置，含方案卡片、图文 Key 教程、剪贴板粘贴与音频检测；随时可在设置里重新运行。
- **真实连接测试**：一次极小的真实请求即可分辨是 Key、网络还是账号的问题，14 个统一错误代码 + 对应建议，测试结果会持久化显示。
- **服务状态与本地诊断**：状态栏芯片一眼看出转写 / AI / 声音是否可用；诊断报告在本机生成，不含 Key、转写和简历内容，可直接贴进 issue。
- **系统托盘**：显示 / 隐藏窗口、开始 / 停止转写、新建会话、设置、服务状态、帮助与教程、检查更新、退出；窗口隐身且不占任务栏时，托盘是可靠的兜底入口。可选「开机自动启动」，默认关闭。
- **应用内帮助与教程**：10 个可折叠主题，含各服务商 Key 教程，离线可读。
- **面向普通用户的文档**：`docs/user/` 下的快速开始、API Key 指南、故障排查、Windows / macOS 安装说明。

### 已知问题

- **安装包未签名**：Windows SmartScreen 会提示未知发布者，需要手动确认；代码签名放到后续版本。
- **没有自动更新**：托盘「检查更新」只是用浏览器打开 Releases 页面，需要手动下载新版本覆盖安装。
- **本地转写需自备 Python**：安装包不包含 Python 与模型权重。想用本地 FunASR / MOSS / Whisper，请按 [docs/windows/SETUP.zh-CN.md](../windows/SETUP.zh-CN.md) 自行配置；云端方案不受影响。
- **macOS 没有安装包**：功能支持 macOS，但本次只能从源码运行；系统声音仍需 BlackHole 等虚拟音频设备。
- **阿里云国际站为 Beta**：实时识别接入地址与中国大陆站不同且仍在验证，本版本未提供预设，建议使用中国大陆站账号。
- **MiMo 极简方案为 Beta**：分段识别按整句返回，字幕跟随性弱于流式方案。
- **macOS 隐身尽力而为**：新版 ScreenCaptureKit 仍可能捕获窗口。

遇到问题：先看应用内「帮助与教程」和 [TROUBLESHOOTING.zh-CN.md](TROUBLESHOOTING.zh-CN.md)，仍未解决就带上诊断信息到 [GitHub Issues](https://github.com/JWM0203/MeetingCopilot/issues)。

---

## English

### Which file to download

| File | Type | Best for |
|---|---|---|
| `MeetingCopilot-0.2.0-beta.1-win-x64.exe` | Installer (NSIS, per-user, no admin) | Normal use. Start-menu and desktop shortcuts, upgrades in place |
| `MeetingCopilot-0.2.0-beta.1-win-x64-portable.exe` | Portable | Not installing anything. Unpacks itself at launch, so the first start is a few seconds slower |

Both are functionally identical. Portable is *not* fully self-contained: settings and sessions still live in `%APPDATA%\MeetingCopilot\`, shared with an installed copy. For a travelling profile, set `MC_USERDATA` to your own folder before launching.

There is **no macOS build** in this release; macOS can be run from source — see [INSTALL_MACOS.en.md](INSTALL_MACOS.en.md).

### Verify your download (SHA256)

Every `.exe` ships with a matching `.exe.sha256` containing the hash CI computed at build time. After downloading, run in PowerShell:

```powershell
Get-FileHash .\MeetingCopilot-0.2.0-beta.1-win-x64.exe -Algorithm SHA256
```

Compare it with the value in the `.sha256` file before running the installer.

<!-- On publish, paste the two CI-produced hashes here:
MeetingCopilot-0.2.0-beta.1-win-x64.exe            <sha256>
MeetingCopilot-0.2.0-beta.1-win-x64-portable.exe   <sha256>
-->

### First run, in four steps

1. **Install and launch.** When SmartScreen says "Windows protected your PC", confirm the source and click *More info → Run anyway*.
2. **Follow the setup wizard** (Welcome → Plan → Services → Connection test → Done). The recommended plan is Alibaba Cloud realtime ASR + DeepSeek answers and needs two of your own API keys; pick "Minimal setup" (MiMo, Beta) to sign up with a single platform. Key instructions: [API_KEYS.en.md](API_KEYS.en.md).
3. **Check the audio.** Step 4 asks you to play something with sound and watch a live level meter, proving the app can actually hear your computer.
4. **Start transcribing.** Back in the main window, play a meeting or video and click **▶ Start**; click **⚡Ans** on one of their lines for an answer you can read aloud, or turn on **Auto**.

Full walkthrough: [QUICK_START.en.md](QUICK_START.en.md).

### What is new in this release

- **Windows installers**: NSIS plus portable, with SHA256 sidecar files. Upgrading and uninstalling both leave `%APPDATA%\MeetingCopilot\` alone.
- **First-run setup wizard**: five steps through the whole bring-your-own-key setup, with plan cards, inline provider tutorials, clipboard paste and an audio check. Re-runnable at any time from Settings.
- **Real connection tests**: one tiny live request tells you whether the key, the network or the account is at fault, with 14 normalized error codes and a concrete next action; verdicts persist across restarts.
- **Service status and local diagnostics**: status-bar chips show at a glance whether transcription, answers and audio are working; the diagnostics report is built locally with no keys, transcripts or resume text in it.
- **System tray**: show/hide, start/stop transcription, new session, settings, service status, help, check for updates and quit — the reliable way back to a window that is hidden and deliberately absent from the taskbar. Optional start-at-login, off by default.
- **In-app help center**: 10 collapsible topics including the per-provider key guides, readable offline.
- **User-facing documentation**: quick start, API key guide, troubleshooting and the Windows / macOS install notes, all under `docs/user/`.

### Known issues

- **Unsigned installers**: Windows SmartScreen reports an unknown publisher and needs a manual confirmation. Code signing is planned for a later release.
- **No auto-update**: the tray's "Check for updates" only opens the Releases page; new versions are installed manually.
- **Local transcription needs your own Python**: the installer ships neither Python nor model weights. To use local FunASR / MOSS / Whisper, follow [docs/windows/SETUP.md](../windows/SETUP.md). Cloud backends are unaffected.
- **No macOS package**: macOS is supported but only from source in this release, and system audio still requires a virtual device such as BlackHole.
- **Alibaba Cloud international is Beta**: its realtime endpoint differs from the mainland one and is still unverified, so no preset ships. Prefer a mainland account.
- **The MiMo minimal plan is Beta**: per-segment recognition returns whole sentences, so captions trail the streaming plan.
- **Stealth on macOS is best-effort**: recent ScreenCaptureKit clients may still capture the window.

Problems: start with the in-app **Help & guides** and [TROUBLESHOOTING.en.md](TROUBLESHOOTING.en.md); if that does not solve it, bring the diagnostics report to [GitHub Issues](https://github.com/JWM0203/MeetingCopilot/issues).
