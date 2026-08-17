# API Key 指南

English version: [API_KEYS.en.md](API_KEYS.en.md)

---

## API Key 是什么

API Key 是你在大模型服务商那边创建的一串凭证，用来证明「这些请求是我发的」。

- **它不是你的账号密码。** 不要把账号密码填进 MeetingCopilot，任何输入框都不需要。
- **它是收费凭据。** 谁拿到 Key，谁就能用你的额度，所以别贴进聊天记录、截图或公开仓库。
- **它可以随时作废。** 一旦泄露，去服务商控制台删除这个 Key 再新建一个即可，账号本身不受影响。

## 费用由谁收

MeetingCopilot 采用 **BYOK（Bring Your Own Key，自带 Key）**：

- Key 由你自己在服务商处创建，用量由服务商直接向你计费；
- MeetingCopilot 没有账号系统、没有服务器，不代收、不分成、不加价；
- 应用内每个「测试连接」按钮会发起一次极小的真实请求（1 个 token、约 1.4 秒音频或一张 64×64 图片），可能产生极少量费用，且只在你点击时发生。

## Key 存在哪里

- 保存前会自动去掉首尾空格、包裹的引号和 `Bearer ` 前缀。
- 使用系统凭据服务加密后写入本机配置文件：Windows 用 DPAPI，macOS 用钥匙串。
- 解密后的 Key **只存在于主进程**，界面层永远拿不到，只能看到「已配置」和后 4 位。
- 如果系统凭据服务不可用，应用会在保存前弹出警告：此时只能做弱保护（混淆），建议先修好系统再保存。
- 删除 Key：设置里对应输入框旁的「删除 Key」→「确认删除」→「保存」。

---

## 各服务商教程

下面的步骤与应用内「帮助与教程 → 各服务商 Key 领取教程」以及配置向导里的卡片完全一致。

### DeepSeek（推荐用于 AI 回答）

用途：AI 回答与转录内联翻译。默认模型 `deepseek-chat`（非思考模式，首个字最快）。

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com/)。
2. 使用手机号或邮箱登录；首次使用请先注册账号。
3. 进入左侧的「API keys」页面。
4. 点击「创建 API key」，填写一个便于识别的名称（例如 MeetingCopilot）。
5. 立即复制生成的 Key —— 它通常只完整显示这一次，关闭弹窗后无法再次查看。
6. 回到 MeetingCopilot，把 Key 粘贴到 AI 回答那张卡片。
7. 点击「保存并测试连接」；若提示余额不足，请在平台的充值页面充值后重试。

常见问题：

- 提示 `Insufficient Balance`：Key 本身有效，去平台充值即可。
- Key 只显示一次：没记下就删掉重建，不影响账号。

可选模型：`deepseek-chat`（快，默认）、`deepseek-v4-flash`（带推理链，首字更慢）、`deepseek-v4-pro`（最强推理，适合复盘不适合抢答）。

### 阿里云百炼 · 中国大陆站（推荐用于实时语音识别）

用途：云端流式语音识别，模型 `fun-asr-realtime`（默认）或 `paraformer-realtime-v2`，接入地址 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`。

1. 打开[阿里云百炼控制台](https://bailian.console.aliyun.com/?tab=model)。
2. 使用阿里云账号登录；首次使用请先注册。
3. 按页面提示开通「百炼」大模型服务平台。
4. 完成实名认证，未实名的账号无法创建可用的 API Key。
5. 确认当前停留在主账号的默认业务空间（子账号或自建业务空间可能没有实时语音识别权限）。
6. 打开右上角头像菜单中的「API-KEY」页面。
7. 点击「创建我的 API-KEY」，业务空间选择默认业务空间后确认。
8. 复制生成的 Key，回到 MeetingCopilot 粘贴到语音识别那张卡片。
9. 点击「保存并测试连接」。

常见问题：

- 提示权限不足 / Access denied：多为尚未开通百炼或未完成实名认证。
- 提示 Model not found：请确认账号属于中国大陆站，国际站账号的接入地址不同。
- 创建后找不到 Key：在「API-KEY」页面切换回主账号的默认业务空间查看。

> **国际站账号（Beta）**：[Model Studio 国际站控制台](https://modelstudio.console.aliyun.com/?tab=playground)同样可以创建 Key，但其实时语音识别接入地址与中国大陆站不同，目前仍在验证中，本版本没有提供预设。需要稳定实时字幕请先用中国大陆站账号。

### MiMo · 小米（一个 Key 兼顾转写与回答，Beta）

用途：`mimo-v2.5-asr` 做分段语音识别、`mimo-v2.5-pro` 做 AI 回答、`mimo-v2.5` 做截图问答，全部走 `https://api.xiaomimimo.com/v1`。

1. 打开 [MiMo 开放平台](https://platform.xiaomimimo.com/)。
2. 使用小米账号登录；首次使用请先完成注册。
3. 进入控制台的「API Keys」页面。
4. 点击新建 API Key，填写名称后确认。
5. 复制以 `sk-` 开头的 Key —— 它通常只完整显示这一次。
6. 回到 MeetingCopilot，把 Key 粘贴到下方输入框。
7. 同一个 Key 可以同时用于语音识别与 AI 回答（极简配置方案）；该用法仍处于 Beta。
8. 点击「保存并测试连接」；若语音识别不可用，请改用推荐方案。

> 分段识别按整句返回，字幕跟随性弱于实时流式方案，这是方案本身的特性，不是故障。

### Google Gemini（可选，用于截图问答）

用途：视觉模型，`https://generativelanguage.googleapis.com/v1beta/openai`，模型 `gemini-2.5-flash`。截图问答是可选功能，不配置也不影响转写和文字回答。

1. 打开 [Google AI Studio 的 API Key 页面](https://aistudio.google.com/app/apikey)。
2. 使用 Google 账号登录。
3. 点击 Create API key，按提示选择或新建一个 Google Cloud 项目。
4. 复制生成的 Key，回到 MeetingCopilot 粘贴到视觉模型的 Key 输入框（设置 → 高级设置 → 视觉模型）。
5. 中国大陆网络通常无法直连 Google，请在「视觉代理」里填写本机代理地址（例如 `127.0.0.1:7897`）。
6. 视觉问答是可选功能，可以跳过；跳过后截图提问会提示尚未配置。

> 想在国内直连，可以改用 MiMo 的视觉模型 `mimo-v2.5`，代理留空即可。

### 自定义（OpenAI 兼容服务）

1. 准备一个 OpenAI 兼容的服务地址（以 `/v1` 结尾）与模型名称。
2. 在 设置 → 高级设置 里填写 Base URL、模型与 API Key。
3. 出于安全考虑，MeetingCopilot 只会用系统浏览器打开内置允许列表里的官方页面，自定义服务商的页面请自行访问。

---

## 测试连接失败怎么办

每个 Key 输入框旁边都有「测试连接」。它把服务商各式各样的报错归一成固定的错误代码，帮你分清是 Key、网络还是账号的问题。完整的代码表和处理办法见 [TROUBLESHOOTING.zh-CN.md](TROUBLESHOOTING.zh-CN.md)。
