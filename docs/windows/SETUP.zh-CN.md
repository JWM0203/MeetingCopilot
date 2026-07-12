# Windows 部署指南

[English](SETUP.md) · [macOS 指南](../macos/SETUP.zh-CN.md)

MeetingCopilot 诞生于 Windows：通过**系统回环音频**直接采集对方声音（无需机器人入会，任何会议软件都适用），并可用内容保护让窗口在屏幕共享中隐身。

## 环境要求

| 组件 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11 |
| 运行时 | Node.js ≥ 20 与 npm |
| 大模型 | 任意 OpenAI 兼容 API key——推荐 DeepSeek |
| 本地流式转录（默认） | Python 3.10 conda 环境 + `funasr` + `torch`，建议 NVIDIA 显卡 |
| 本地 Whisper（离线兜底） | `whisper-large-v3-turbo` ONNX 权重，支持 DirectML 的显卡 |
| 云端转录（可选） | 阿里云百炼（DashScope）key，或 MiMo key |

## 安装与启动

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall 自动应用 patches/（transformers.js 补丁，勿删）
npm run build
start.bat          # 或 npm start
```

> 🇨🇳 国内 npm / Electron 下载慢时，在项目根目录建 `.npmrc`：
> `registry=https://registry.npmmirror.com` 和
> `electron_mirror=https://npmmirror.com/mirrors/electron/`。

## 音频采集

无需任何配置。点 **▶ 开始** 即通过 Electron 的 display-media 处理器采集整机回环音频（对方声音）；独立的 **🎤** 按钮在单独通道转录你自己的麦克风。

## 本地流式 FunASR（默认转录后端）

```bash
conda create -n funasr python=3.10 -y
conda activate funasr
# 按你的显卡选 torch 版本（RTX 50 系示例为 cu128）：
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install funasr modelscope websockets numpy
```

应用会**自动拉起并回收**引擎（`tools/funasr_stream_server.py`，`ws://127.0.0.1:10097`）——在设置里选中预设即可。当前选中的模型首次运行时从 ModelScope 自动下载（paraformer 约 880 MB，Nano 约 1.7 GB）。Python 解释器的查找顺序：环境变量 `MC_FUNASR_PYTHON` → 项目 `.venv\Scripts\python.exe` → `C:\ProgramData\miniconda3\envs\funasr\python.exe` → PATH 里的 `python`。

## 本地 Whisper turbo（离线兜底）

把 [`onnx-community/whisper-large-v3-turbo-ONNX`](https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX) 放到 `%APPDATA%/MeetingCopilot/models/onnx-community/whisper-large-v3-turbo-ONNX/`（`encoder_model_fp16.onnx`、`decoder_model_merged_quantized.onnx` 及 config/tokenizer 等文件）。编码器经 DirectML 跑在 GPU 上。

## 隐身

内容保护（标题栏「隐身」开关，默认开启）让窗口在 Windows 的 OBS、屏幕共享、截图中不可见。全局快捷键默认 **Control+B**（隐藏/呼出）、**Control+Shift+S**（框选截图问答）。

## 数据位置

- 设置 / 会话 / 资料：`%APPDATA%/MeetingCopilot/`（纯 JSON）
- API key：Windows DPAPI（`safeStorage`）加密落盘
