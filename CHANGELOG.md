# Changelog / 更新记录

## 0.2.0-beta.2 — 2026-11-02

[Published prerelease / 已发布预发布版本](https://github.com/JWM0203/MeetingCopilot/releases/tag/v0.2.0-beta.2). Unsigned Windows x64 installer and portable builds with SHA256 checksums; no macOS installer. / 提供未签名的 Windows x64 安装版、免安装版及 SHA256 校验文件；不提供 macOS 安装包。

### 贡献致谢 / Contributor acknowledgments

感谢 [@Lupine666](https://github.com/Lupine666) 在 [PR #3](https://github.com/JWM0203/MeetingCopilot/pull/3) 中贡献本地多文档 RAG、资料索引管理、每会话范围与回答引用。本版本在该贡献基础上进行了审查、修复和整合，并非原 PR 直接合并。感谢 [@rcdfrd](https://github.com/rcdfrd) 在 [PR #4](https://github.com/JWM0203/MeetingCopilot/pull/4) 中提出 DeepSeek thinking 控制与模型迁移的兼容性修复，本版本参考了该贡献；该 PR 未直接合并。

Thanks to [@Lupine666](https://github.com/Lupine666) for the local multi-document RAG, index management, per-session scope and answer references contributed in [PR #3](https://github.com/JWM0203/MeetingCopilot/pull/3). This release is based on that contribution with review, fixes and integration, not a direct merge of the original PR. Thanks also to [@rcdfrd](https://github.com/rcdfrd) for the DeepSeek thinking-control and model-migration compatibility fixes proposed in [PR #4](https://github.com/JWM0203/MeetingCopilot/pull/4), which informed this update; that PR was not directly merged.

### 新增

- 可选本地多文档 RAG 资料库：支持按会话选择资料范围、检索引用与索引管理，默认关闭。基于 [PR #3](https://github.com/JWM0203/MeetingCopilot/pull/3) 的贡献进行审查、修复和整合，不代表该 PR 已直接合并。
- 撤销最近一次会话删除；TXT 导出转录和回答，不包含导入的简历/JD 或隐藏备忘。
- 文本回答失败后可手动重试；超时有界，不自动重复重试已产生的部分回答。

### 改进

- 深浅主题统一为中性色玻璃界面，紧凑按钮与气泡；逐句翻译/回答按钮直接可见，窄窗口控制区支持换行。
- 保留面板背景透明度滑块和默认值 0.55，文字与按钮不随背景变淡，不修改原生整窗透明度。
- 悬浮提示在应用窗口内绘制，替代主界面的原生 title 提示，并保留可访问名称与键盘提示。
- 采集保护改为下次启动生效：分别显示当前状态、保存偏好与待生效状态；新用户/缺少设置默认开启，已有明确关闭选项保留。正常退出再打开才应用，隐藏到托盘不算退出；不自动重启或重建窗口。
- DeepSeek 官方端点使用 Flash 预设与显式非思考模式；旧预设迁移不改写第三方中转端点/模型名称。相关需求参考 [PR #4](https://github.com/JWM0203/MeetingCopilot/pull/4)，不表示该 PR 已合并。

### 修复

- RAG 五项审查问题：单次原子替换保存向量与元数据并校验完整性；单文件读取失败不终止整次扫描；先按会话范围过滤再取检索候选；初始化失败后重置工作进程以便重试；使用真实外部目录/文件软链接验证根目录边界。
- 采集启动失败时释放资源，合并重复启动，停止后忽略过期权限/音频工作线程结果；ASR 恢复后清除引擎警告，不遮蔽独立麦克风/采集错误。
- 翻译、文档导入和截图异步结果保留在发起会话，避免切换会话后写错位置。
- 浮动选区回答提交前重新校验当前选区；修复窗口边缘裁切、切换会话及清空后残留浮层。
- 保护设置保存失败时回滚偏好，不显示虚假保存成功；保护开启、请求开启未确认或状态未知时，抑制应用自己的“窗口已隐藏”系统通知。

### 限制

- 采集保护不保证所有录屏/共享方式不可见；框选截图仍有已知单帧/任务栏暴露限制。运行时保护切换问题未修复，以下次启动设置避开该路径；两个原生透明度刷新试验已撤回。
- RAG 启用后下载嵌入模型并占用本机资源；检索片段会发送给配置的模型服务商，可能增加费用。
- 自动化界面/打包测试不能替代真实音源、付费服务、Windows 11 或所有 macOS 录屏方式的验证。最终安装包与发布结果以对应提交的构建和 Release 附件为准。

### Added

- Optional local multi-document RAG, per-session document scope, source references and index management; OFF by default. Reviewed and repaired integration based on the contribution in [PR #3](https://github.com/JWM0203/MeetingCopilot/pull/3), not a claim that the PR was directly merged.
- Undo the latest session deletion; TXT export of transcripts and answers, excluding imported resume/JD material and hidden memo.
- Manual retry for failed text answers and bounded request timeouts; partially generated answers are not automatically retried.

### Improved

- Neutral light/dark glass styling, compact controls, directly visible per-line Translate/Answer actions and narrow-window wrapping.
- Panel-background transparency retains its slider and 0.55 default without fading text/controls or changing native whole-window opacity.
- In-window hover hints replace native title popups in the main interface, retaining accessible names and keyboard hints.
- Protection preferences apply on the next launch, with current state, saved preference and pending state shown separately. New/missing preferences default to ON; explicit OFF is preserved. Quit normally and reopen; tray hiding is not quitting. No automatic restart or window recreation.
- Official DeepSeek endpoints use the Flash preset with explicit non-thinking mode. Legacy migration preserves third-party relay endpoints/model names. Related requirements came from [PR #4](https://github.com/JWM0203/MeetingCopilot/pull/4); this does not claim it was merged.

### Fixed

- Five RAG review issues: atomic vector/metadata storage with integrity validation; per-file scan error isolation; scope filtering before candidate truncation; worker reset after initialization failure; real outside-root directory/file symlink regression coverage.
- Audio startup failure cleanup, duplicate-start coalescing and stale permission/worklet cancellation after Stop. Recovered ASR engine warnings clear without hiding independent microphone/capture errors.
- Translation, document-import and screenshot results stay with their originating session.
- Floating answers revalidate the live selection; toolbar clipping and stale popups after session switching/clearing are addressed.
- Failed protection-preference saves roll back rather than claim success. The app's own hidden-window OS notification is suppressed when protection is active, requested but unconfirmed, or unknown.

### Limitations

- Capture protection is not universal invisibility. Region selection retains a known one-frame/taskbar exposure limitation. Runtime toggling remains unresolved; next-launch preferences avoid that path. Two native-opacity refresh experiments were withdrawn.
- RAG downloads an embedding model and consumes local resources. Retrieved snippets go to the configured model provider and may add costs.
- Automated UI/package checks do not establish physical-audio, paid-provider, Windows 11 or all macOS recording compatibility. Final installer/release status depends on the exact commit's build results and Release assets.
