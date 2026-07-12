# macOS 部署指南

[English](SETUP.md) · [Windows 指南](../windows/SETUP.zh-CN.md)

macOS 版保留了完整链路——流式转录、提词式回答、简历/JD 贴合——但有两个平台差异：

1. **没有系统回环采集。** Electron 的 `audio: 'loopback'` 仅支持 Windows，macOS 上「对方」通道改为从可选择的**音频输入设备**录制。要听到会议软件的声音，需要经 BlackHole 等虚拟设备路由系统音频（见下文）。
2. **隐身是尽力而为。** 新版 ScreenCaptureKit 客户端仍可能捕获窗口，macOS 上无法保证完全隐身。

工程细节见 [移植 SDD](macos-port-sdd.md)。

## 环境要求

| 组件 | 要求 |
|---|---|
| 操作系统 | Apple 芯片 macOS 14+ |
| 运行时 | Node.js ≥ 20 与 npm |
| 大模型 | 任意 OpenAI 兼容 API key——推荐 DeepSeek |
| 本地流式转录（默认） | 项目 `.venv` 里的 Python 3.10/3.11；Apple MPS，自动 CPU 回退 |
| 系统声音采集 | [BlackHole](https://github.com/ExistentialAudio/BlackHole)（或同类虚拟音频设备） |
| 云端转录（可选） | 阿里云百炼（DashScope）key，或 MiMo key |

## 安装与启动

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall 自动应用 patches/（transformers.js 补丁，勿删）
npm run build
npm start
```

## 音频：把会议声音接进 MeetingCopilot

要采集会议软件（腾讯会议 / Zoom / …）而不是内置麦克风：

1. **安装 BlackHole**（2 声道版即可）：
   ```bash
   brew install blackhole-2ch
   ```
2. **创建多输出设备**，保证你自己还能听到会议声音：打开**音频 MIDI 设置** → `+` → *创建多输出设备* → 同时勾选你的扬声器/耳机**和** BlackHole 2ch。
3. **把系统输出指向它**：系统设置 → 声音 → 输出 → 选择该多输出设备。此后声音照常从扬声器播放，同时镜像进 BlackHole。
4. **在 MeetingCopilot 里选中 BlackHole**：点 **▶ 开始**（首次需授权麦克风），然后在按钮旁的输入下拉里选 *BlackHole 2ch*。

该通道已关闭回声消除/降噪/自动增益，虚拟设备的 PCM 原样进入转录；独立的 **🎤** 通道仍保留正常麦克风处理，用于你自己的声音。

## 本地流式 FunASR（默认转录后端）

Apple 芯片上已验证的项目内环境：

```bash
# 在仓库根目录执行
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-funasr.txt
npm start
```

应用会自动发现 `.venv`（查找顺序：环境变量 `MC_FUNASR_PYTHON` → 项目 `.venv/bin/python` → `python3` → `python`）。`--device auto` 依次尝试 CUDA、Apple MPS、CPU；加速器初始化失败自动退回 CPU。应用只加载当前选中的一个 FunASR 模型，控制 8 GB 机型的内存占用——切换模型会重启引擎（60–90 秒）。选中的模型首次运行时从 ModelScope 自动下载（paraformer 约 880 MB，Nano 约 1.7 GB）。

## 隐身限制

「隐身」开关仍会应用 Electron 内容保护，旧式采集 API 会遵守；但基于新版 **ScreenCaptureKit** 的应用可能仍能捕获窗口——macOS 上请把隐身当作尽力而为。全局快捷键默认 **Command+B**（隐藏/呼出）、**Command+Shift+S**（框选截图问答）。

## 数据位置

- 设置 / 会话 / 资料：`~/Library/Application Support/MeetingCopilot/`（纯 JSON）
- API key：经 macOS 钥匙串（`safeStorage`）加密落盘
