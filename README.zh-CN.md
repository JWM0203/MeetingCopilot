<div align="center">

# MeetingCopilot

**Windows / macOS 实时会议与面试助手**

实时转录对方说话 · 第一人称提词式回答 · 采集保护

<a href="https://github.com/JWM0203/MeetingCopilot/stargazers"><img src="https://img.shields.io/github/stars/JWM0203/MeetingCopilot?style=flat-square&logo=github&color=2a6df4" alt="GitHub stars"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-3da639?style=flat-square" alt="license"></a>
<a href="https://github.com/JWM0203/MeetingCopilot"><img src="https://img.shields.io/badge/GitHub-仓库-181717?style=flat-square&logo=github" alt="GitHub 仓库"></a>
<a href="https://gitee.com/jwm0302/MeetingCopilot"><img src="https://img.shields.io/badge/Gitee-国内镜像-C71D23?style=flat-square&logo=gitee" alt="Gitee 国内镜像"></a>
<a href="https://www.xiaohongshu.com/discovery/item/6a50ddc800000000080027a6?source=webshare&xhsshare=pc_web&xsec_token=YBsteWYkixo34xXwfYeNXKL1SFbiOeg7mxQAZyq7wQIc4=&xsec_source=pc_share"><img src="https://img.shields.io/badge/小红书-视频介绍-ff2442?style=flat-square&logo=xiaohongshu&logoColor=white" alt="小红书视频介绍"></a>

[English](README.md) · [下载](#下载) · [5 分钟快速配置](#5-分钟快速配置) · [功能亮点](#功能亮点) · [转录后端](#转录后端) · [开发](#开发) · [协议](#协议)

</div>

## 下载

**普通用户**：下载安装包直接用——不需要 Node.js、不需要 Python、不用敲命令。
**开发者**：跳到 [开发](#开发) 一节，从源码运行。

**[⬇ 下载最新版本](https://github.com/JWM0203/MeetingCopilot/releases/latest)**

| 文件 | 类型 | 适合 |
|---|---|---|
| `MeetingCopilot-<版本>-win-x64.exe` | 安装版（NSIS，当前用户） | 常规使用——带开始菜单和桌面快捷方式，可原地升级 |
| `MeetingCopilot-<版本>-win-x64-portable.exe` | 免安装版 | 不想装东西；注意设置仍保存在 `%APPDATA%` |

**系统要求**：Windows 10 / 11（x64），无需管理员权限，另需你自己的 API Key——MeetingCopilot 采用 BYOK 自带 Key 模式，不代收任何费用。

> ⚠️ **当前 Beta 版本尚未做代码签名**，Windows SmartScreen 会弹出提醒。确认文件来自官方发布页后，点「更多信息」→「仍要运行」。每个 `.exe` 旁都有同名的 `.exe.sha256`（CI 构建时算出的哈希），可用 `Get-FileHash .\MeetingCopilot-<版本>-win-x64.exe -Algorithm SHA256` 核对。

> 🍎 **macOS**：本次没有提供安装包。macOS 支持从源码运行，见 [INSTALL_MACOS.en.md](docs/user/INSTALL_MACOS.en.md)。

**用户文档**：[快速开始](docs/user/QUICK_START.zh-CN.md) · [API Key 指南](docs/user/API_KEYS.zh-CN.md) · [故障排查](docs/user/TROUBLESHOOTING.zh-CN.md) · [Windows 安装与数据位置](docs/user/INSTALL_WINDOWS.zh-CN.md)

---

![实时演示：边说边转录 + 自动回答](docs/demo.gif)

*真实录屏（非摆拍）：面试官话还没说完，左栏灰色实时字幕已经跟上；说完自动触发右栏回答，内容严格贴合你的简历、可直接照着念。*

### 🎬 三分钟真实使用实录

[![点击观看演示视频](docs/video-poster.jpg)](docs/MeetingCopilot-demo.mp4)

*点击观看（带声音）：拿一个英文播客和一个中文视频当"对方"——中英双语实时转录、内联翻译、中英文自动回答，屏幕上实测端到端延迟 0.94 秒。*

## 5 分钟快速配置

首次启动会自动打开配置向导——一个普通的、能被屏幕共享看到的窗口，方便别人远程帮你。一共五步：

1. **欢迎**——说明 BYOK 自带 Key 模式、API Key 是什么，以及哪些内容会离开你的电脑。在这里选中文 / English，选中的就是应用界面语言。
2. **选择方案**——*低延迟推荐*（阿里云百炼实时识别 + DeepSeek 回答，2 个 Key）、*极简配置*（MiMo 一个 Key 兼顾两者，Beta）、*只使用实时转写*（1 个 Key）、*高级配置与本地模式*（什么都不改，自己进设置配）。
3. **配置服务**——卡片内自带图文教程：打开官方 Key 页面 → 粘贴 → 点「保存并测试连接」。Key 会先用系统凭据服务加密再落盘。
4. **连接测试**——带音量条的检测卡片确认应用能听到电脑声音，可选启用麦克风通道，并逐项列出还差什么。
5. **完成**——整套方案作为一次设置写入，主界面随即打开。

然后：放一段有人说话的声音，点 **▶ 开始**，在任意一句上点 **⚡答**。完整走查见 [QUICK_START.zh-CN.md](docs/user/QUICK_START.zh-CN.md)。

配置向导随时可以重开：*⚙ 设置 → 重新运行配置向导*；应用内的 **帮助与教程**（托盘菜单或设置里）提供同样内容，离线可读。

![设置面板](docs/settings.png)

## 功能亮点

- 🎧 **直接听对方的声音，不进会**：Windows 采集系统回环音频；macOS 使用可选择的音频输入（会议/系统声音可通过 BlackHole 等虚拟设备路由）。麦克风为独立通道，可单独转录你自己的发言。
- ⚡ **四类转录后端随心切**：本地侧车（FunASR 默认；MOSS-Transcribe 0.9B 实验）· 本地 Whisper turbo（离线兜底，DirectML GPU）· 阿里云 `fun-asr-realtime`（云端逐字流式）· MiMo 按段。FunASR 说话中即出灰色实时字幕，MOSS 在停顿后整句输出。
- 🌍 **中英双语开箱即用**：一场会里中英夹着说，转录自动识别语言切换，不用动任何设置；答案语言点一下 `答:EN` 就切成英文提词，照样贴合你的简历——外企英文面试直接用。
- 🌐 **界面中英文一键切换**：按钮、提示、对话框、状态栏全部有中英两套文案，在 *设置 → 外观 → 界面语言* 里切换；首次启动自动跟随系统语言。界面语言与答案语言互相独立——可以英文界面配中文答案，反之亦然。
- 🧠 **第一人称提词式回答**：自带 key（BYOK），任何 OpenAI 兼容大模型均可（推荐 DeepSeek）。答案就是你能一字不改念出来的话——先结论后要点；行为题按 STAR 展开；技术题先思路再关键点、必要时给复杂度；绝不编造简历之外的经历。
- 📄 **简历 / 岗位 JD 双槽按会话导入**：支持 `.md/.txt/.docx/.pdf`，全部本地确定性解析、不上传。自动识别题型（行为 / 技术 / 寒暄）并附零延迟提示。
- 🔁 **滚动面试备忘**：每次回答后异步更新一份结构化备忘（已问问题 / 我已声称的事实 / 面试官关注点），一小时的面试前后不打架，每次请求的 token 数恒定不膨胀。
- 🚀 **前缀缓存预热**：点 ▶ 的同时发出一条 1-token 请求，提前建好大模型的 KV 前缀缓存，第一个真实问题直接命中（DeepSeek `prompt_cache_hit_tokens` 实测验证），采集期间自动保温。
- 🖼️ **框选截图问答**：拖框选中屏幕任意区域问视觉模型（MiMo / Gemini），框选层本身对录屏不可见。
- 🥷 **采集保护**：内容保护配合全局快捷键隐藏/呼出。Windows 可在受支持的采集方式中排除窗口；macOS 面对新版 ScreenCaptureKit 无法保证完全隐身。
- 🩺 **连接测试、服务状态与本地诊断**：一键分辨是 Key、网络还是账号的问题（14 个统一错误代码）；诊断报告在本机生成，不含 Key、转写和简历内容。
- 🔔 **系统托盘**：显示/隐藏窗口、开始/停止转写、新建会话、设置、服务状态、帮助、退出，全在托盘菜单里，不占任务栏。开机自动启动为可选项，默认关闭。
- 🌗 **深色 / 浅色 / 跟随系统**三主题，答案区三档大字体，延迟 HUD，转录内联翻译，多会话隔离（每场会议独立的转录 + 对话 + 资料）。

| 深色 | 浅色 |
|---|---|
| ![深色主题](docs/main-dark.png) | ![浅色主题](docs/main-light.png) |

### 界面语言一键切换（中 ⇄ 英）

![界面语言从中文切换到英文](docs/language-switch.gif)

*设置 → 外观 → 界面语言：整个界面——标题栏、面板、悬浮提示、系统对话框——瞬间切换。英文界面截图见 [README.md](README.md)。*

### 同一场会里的中英双语

![双语演示：中英自动切换识别](docs/demo-bilingual.gif)

*先一个中文问题、再一个英文问题——同一会话、零设置改动，本地转录自动识别语言切换（都在 1.6 秒左右上屏）；点一下 `答:EN`，英文答案照样严格贴合同一份简历。*

![英文回答](docs/bilingual.png)

## 转录后端

| 后端 | 延迟 | 费用 | 隐私 | 说明 |
|---|---|---|---|---|
| 阿里云 `fun-asr-realtime`（**安装包用户推荐**） | 最佳 | 按量 | 云端 | 逐字流式，服务端断句带标点，零安装 |
| MiMo 按段 | ~1 s/段 | 按量 | 云端 | 简单的按句云端转录；同一个 Key 还能兼顾 AI 回答 |
| **本地 FunASR 流式**（源码运行时的默认值） | ~1.2–1.8 s | 免费 | ✅ 完全本地 | `Fun-ASR-Nano`（中英双优+标点）或 `paraformer` 真流式（纯中文，字幕更跟手） |
| MOSS-Transcribe-Diarize 0.9B（实验） | 停顿后整句 | 免费 | ✅ 完全本地 | 50+ 语言、热词、长会议/说话人分离能力；本应用实时模式只取转写文本 |
| 本地 Whisper turbo | Windows 支持的 GPU 上约 2 s | 免费 | ✅ 完全本地 | Windows 用 DirectML；其他平台 CPU 回退 |

**该选哪个？** 用安装包的话就用**云端**后端：填一个 API Key 就能跑，别的什么都不用装。**本地**后端属于进阶选项——免费、完全私密，但需要你自己准备 Python 环境并等模型权重下载，安装包不包含这些。

## 本地 ASR 与高级配置

### 各后端的环境要求

| 组件 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11，或 Apple 芯片 macOS 14+ |
| 云端转录（**推荐**） | 阿里云百炼（DashScope）key，或 MiMo key |
| 大模型 | 任意 OpenAI 兼容 API key——推荐 DeepSeek（快、便宜、带前缀缓存） |
| 本地流式转录 | Python 3.10/3.11 + `funasr` + `torch`；支持 CUDA、Apple MPS 或 CPU 回退 |
| MOSS 实验转录 | 独立 Python 3.12 环境；NVIDIA CUDA BF16 优先，失败自动回退 CPU |
| 本地 Whisper（离线兜底） | `whisper-large-v3-turbo` ONNX 权重；Windows 用 DirectML，其他平台用 CPU |
| 从源码运行 | Node.js ≥ 20 与 npm |

音频采集方式、Python 环境、隐身行为和快捷键因系统而异——每个系统有自己目录下的专属指南：

| 平台 | 音频采集 | 隐身 | 指南 |
|---|---|---|---|
| 🪟 **Windows 10 / 11** | 系统回环——零配置 | 窗口对采集不可见 | **[docs/windows/SETUP.zh-CN.md](docs/windows/SETUP.zh-CN.md)** |
| 🍎 **macOS 14+（Apple 芯片）** | 输入设备 + [BlackHole](https://github.com/ExistentialAudio/BlackHole) 路由 | 尽力而为（ScreenCaptureKit 可能捕获） | **[docs/macos/SETUP.zh-CN.md](docs/macos/SETUP.zh-CN.md)** |

### 本地流式 FunASR

一次性配好 Python 环境后，应用会**自动拉起并回收**引擎（`tools/funasr_stream_server.py`，`ws://127.0.0.1:10097`）——在设置里选中预设即可。当前选中的模型首次运行时从 ModelScope 自动下载（paraformer 约 880 MB，Nano 约 1.7 GB）。`--device auto` 自动选择 CUDA / Apple MPS / CPU，失败自动退回 CPU。

- **Windows**（conda 环境，NVIDIA 显卡）：见 [docs/windows/SETUP.zh-CN.md](docs/windows/SETUP.zh-CN.md#本地流式-funasr默认转录后端)
- **macOS**（项目 `.venv`，Apple MPS）：见 [docs/macos/SETUP.zh-CN.md](docs/macos/SETUP.zh-CN.md#本地流式-funasr默认转录后端)

Python 装在别处时，设置环境变量 `MC_FUNASR_PYTHON` 指向完整路径即可。

### MOSS-Transcribe-Diarize 0.9B（实验）

MOSS 是整段生成模型，不是原生流式 ASR。本应用会在一句话结束后调用独立侧车 `tools/moss_asr_server.py`，避免高频重跑造成显存抖动。默认优先使用 CUDA BF16，CUDA 初始化或推理失败时回退 CPU；现有 FunASR 环境和默认设置完全不变。

- **Windows**：见 [docs/windows/SETUP.zh-CN.md](docs/windows/SETUP.zh-CN.md#实验moss-transcribe-diarize-09b)
- 自定义解释器：设置 `MC_MOSS_PYTHON`；强制设备可设置 `MC_MOSS_DEVICE=cuda:0` 或 `cpu`。

### 本地 Whisper turbo

把 [`onnx-community/whisper-large-v3-turbo-ONNX`](https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX) 放到 `<userData>/models/onnx-community/whisper-large-v3-turbo-ONNX/`——Windows 为 `%APPDATA%/MeetingCopilot/`，macOS 为 `~/Library/Application Support/MeetingCopilot/`（`encoder_model_fp16.onnx`、`decoder_model_merged_quantized.onnx` 及 config/tokenizer 等文件）。编码器在 Windows 走 DirectML，其他平台走 CPU。

### 云端接入地址

- **阿里云百炼**：地址 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`，模型 `fun-asr-realtime` 或 `paraformer-realtime-v2`。
- **MiMo**：`https://api.xiaomimimo.com/v1`，模型 `mimo-v2.5-asr`。

## 隐私

- API key 使用 Electron `safeStorage`（Windows DPAPI / macOS Keychain）加密落盘，永远不进渲染进程。
- 全部数据位于 Electron 的用户数据目录（Windows：`%APPDATA%/MeetingCopilot/`；macOS：`~/Library/Application Support/MeetingCopilot/`）。无遥测、无账号、无服务器。
- 用本地转录后端时，音频不出你的电脑；大模型自带 key，转录文本只发给你自己配置的服务商。
- 诊断报告在本机生成，不含 Key、转写和简历内容，可以直接贴到公开 issue。

## 开发

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall 自动应用 patches/（transformers.js 补丁，勿删）
npm run build      # 构建 main + preload + renderer 到 out/
npm start          # 跨平台；Windows 也可使用 start.bat
```

从源码运行同样会先进配置向导。设置 `MC_DEV_DEFAULT_LOCAL_ASR=1` 可跳过向导，直接用本地 FunASR 默认值进入主界面。

```bash
npm test            # 单元测试（prompt 组装 / VAD / 持久化 / 文档解析 / 流式协议 / 托盘 / 链接）
npm run typecheck   # 双 tsconfig（主进程 + 渲染层）
npm run dev         # vite HMR 开发模式
npm run verify      # typecheck + 测试 + 构建，提交前的统一闸门
npm run dist:dir    # 免打包构建到 release/win-unpacked
npm run dist:win    # 生成 nsis 安装包与免安装版
npm run smoke:packaged        # 启动打包后的 exe，验证两条启动路径
node tools/rt-asr-smoke.mjs   # 流式转录协议冒烟（需设 MC_RT_URL / MC_RT_KEY）
```

开发者的分平台环境配置（Python 环境、音频路由、隐身）：[docs/windows/SETUP.zh-CN.md](docs/windows/SETUP.zh-CN.md) · [docs/macos/SETUP.zh-CN.md](docs/macos/SETUP.zh-CN.md)。

> 🇨🇳 国内 npm / Electron 下载慢时，在项目根目录建 `.npmrc`：
> `registry=https://registry.npmmirror.com` 和
> `electron_mirror=https://npmmirror.com/mirrors/electron/`。

架构一句话：Electron 主进程（窗口 / 隐身 / 托盘 / IPC / LLM 路由 / ASR 宿主）→ ASR 引擎全部跑在 **utilityProcess** 里（绝不进主进程——DirectML 推理在主进程会挂死）→ React 渲染层（左转录 + 右回答双栏）；所有状态存本地 JSON 文件，绝不用 DOM 存储。

## 免责声明

本工具面向个人学习与辅助用途。会议 / 面试中能否使用实时辅助，取决于你所在地的法律与对方的规则——使用本软件产生的一切后果由使用者自行承担。

## 协议

**[Apache License 2.0](LICENSE)**——在协议条款下可自由使用、修改、再分发，包括商业用途。
