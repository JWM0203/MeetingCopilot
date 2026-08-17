# Windows 安装说明

English version: [INSTALL_WINDOWS.en.md](INSTALL_WINDOWS.en.md)

面向使用安装包的普通用户。从源码运行请看仓库 README 的「开发」一节。

---

## 系统要求

| 项目 | 要求 |
|---|---|
| 系统 | Windows 10 / 11，64 位（x64） |
| 权限 | 不需要管理员权限 |
| 磁盘 | 安装版约 400 MB；使用本地转写还需为模型预留 1–2 GB |
| 运行时 | 无需 Node.js。只有使用**本地**转写后端时才需要自备 Python |

---

## 下载哪个文件

[Releases 页面](https://github.com/JWM0203/MeetingCopilot/releases/latest)提供两个文件：

| 文件 | 类型 | 适合 |
|---|---|---|
| `MeetingCopilot-<版本>-win-x64.exe` | 安装版（NSIS） | 常规使用。装完有开始菜单和桌面快捷方式 |
| `MeetingCopilot-<版本>-win-x64-portable.exe` | 免安装版 | 不想装东西、想放在 U 盘或受限电脑上临时用 |

每个 `.exe` 旁边还有一个同名的 `.exe.sha256`，里面是 CI 构建时算出的哈希值。

### 核对 SHA256（建议）

在下载目录打开 PowerShell：

```powershell
Get-FileHash .\MeetingCopilot-<版本>-win-x64.exe -Algorithm SHA256
```

把输出的哈希和 `.sha256` 文件里的值比对，一致即可。

---

## 安装（安装版）

1. 双击 `MeetingCopilot-<版本>-win-x64.exe`。
2. 当前是**未签名**的 Beta 版本，SmartScreen 会提示「已保护你的电脑」。确认来源后点「更多信息」→「仍要运行」。
3. 安装器是一键式的：不会问你安装路径，直接装到**当前用户**目录（`%LOCALAPPDATA%\Programs\` 下），不写 `Program Files`，也不需要管理员权限。
4. 自动创建开始菜单和桌面快捷方式。
5. 安装完成后应用会自动启动，首次启动进入配置向导（见 [QUICK_START.zh-CN.md](QUICK_START.zh-CN.md)）。

## 使用（免安装版）

- 双击即可运行，不写注册表、不创建快捷方式。
- 启动时需要先把自身解压到临时目录，所以**第一次启动比安装版慢**几秒到十几秒。
- 注意：免安装版**不是完全绿色**——设置、会话、简历等数据仍然写在 `%APPDATA%\MeetingCopilot\`，和安装版共用同一份数据。
- 想要真正的「数据也跟着走」，可以在启动前设置环境变量 `MC_USERDATA` 指向你自己的目录，例如：

  ```powershell
  $env:MC_USERDATA = "D:\MeetingCopilotData"
  .\MeetingCopilot-<版本>-win-x64-portable.exe
  ```

  这样所有配置和会话都写进那个目录。这是高级用法，日常使用不必设置。

---

## 数据存在哪里

| 内容 | 路径 |
|---|---|
| 设置（含加密后的 API Key） | `%APPDATA%\MeetingCopilot\settings.json` |
| 会话（转录 + 问答 + 导入的资料） | `%APPDATA%\MeetingCopilot\sessions.json` |
| 全局知识库 | `%APPDATA%\MeetingCopilot\knowledge.md` |
| 本地 Whisper 模型（若使用） | `%APPDATA%\MeetingCopilot\models\` |

在资源管理器地址栏输入 `%APPDATA%\MeetingCopilot` 即可打开，或者用 设置 → 高级设置 → 诊断信息 →「打开日志文件夹」。

**API Key 不是明文保存的**：先用 Windows DPAPI 加密再写入 `settings.json`，且与当前 Windows 用户绑定——换用户或重装系统后需要重新填写。

---

## 升级

1. 下载新版本的安装包，直接覆盖安装即可（安装器会先卸载旧版本再装新的）。
2. `%APPDATA%\MeetingCopilot\` 不会被动到，**设置、Key 和会话全部保留**。
3. 本版本没有自动更新功能。托盘菜单里的「检查更新」会用浏览器打开 Releases 页面，由你自己决定要不要下载。

## 卸载

- 从「设置 → 应用」或开始菜单卸载。
- **卸载默认不会删除你的数据**（`deleteAppDataOnUninstall: false`），升级时也一样。
- 想彻底清干净，卸载后手动删除 `%APPDATA%\MeetingCopilot\` 目录。删除前请确认里面没有你还需要的会话记录。

---

## 需要本地转写时的额外准备

云端方案开箱即用；只有选择「本地侧车 ASR（FunASR / MOSS）」或「本地 Whisper turbo」时，才需要自己准备 Python 环境和模型权重。安装包**不包含**这些。步骤见 [docs/windows/SETUP.zh-CN.md](../windows/SETUP.zh-CN.md)。

---

## 相关文档

- [QUICK_START.zh-CN.md](QUICK_START.zh-CN.md) —— 5 分钟跑通第一场会
- [API_KEYS.zh-CN.md](API_KEYS.zh-CN.md) —— 各服务商 Key 怎么领
- [TROUBLESHOOTING.zh-CN.md](TROUBLESHOOTING.zh-CN.md) —— 错误代码表与排查
