# UI update / 界面大更新

> Beta release preparation; publication and installer availability are not yet confirmed. See [CHANGELOG](../../CHANGELOG.md). / Beta 发布准备中，尚未确认发布和安装包可用状态。完整更新见[更新记录](../../CHANGELOG.md)。

## 中文

这次更新围绕真实应用界面展开，而不是把设计图当成可以使用的软件。界面调整必须保留原有转录、回答、截图、会话、设置与资料库的实际操作路径；不会在展示中伪造转录或模型回答，也不会把界面检查当成真实服务验证。

### 本次界面变化

- 深浅主题改为更克制的中性色玻璃风格：轻边框、圆角气泡与紧凑按钮；移除回答卡片的彩色左侧条。
- 保留面板背景透明度滑块与 0.55 默认值，不改变原生整窗透明度；包括实时转录在内的正文不随容器一起变淡。
- 每条转录的翻译/回答操作直接可见；选中文字后的浮动按钮继续用于“回答选中内容”。提交时重新读取左侧转录区的有效选区，避免发送已经清除或移到其他面板的旧文本；这不是新增浮动翻译按钮。
- 顶部控制与状态信息支持窄窗口换行，继续单独显示当前保护状态、下次启动偏好和待生效提示；保留键盘焦点样式与减少动画偏好。
- 只迁移生产样式与上述选区保护逻辑，没有复制设计演示中的模拟内容、请求逻辑或外部字体资源。

### 保留的能力与使用方式

- 系统音频与独立麦克风转录、逐句回答、持续答、翻译和截图问答仍使用用户选择的真实后端。
- 会话、简历/JD、删除撤销、文本导出和可选多文档资料库继续按原有数据流工作。资料库默认关闭；启用会下载模型并占用本机资源，检索片段会发送给配置的回答服务商。
- 面板背景透明度与文字/按钮的可读性分开处理，不通过整窗降透明度把文字一起变淡。不能仅凭静态截图证明动态显示正常。
- 隐身设置仍是**下次启动生效**：分别显示当前保护状态与下次启动偏好。新用户或缺少设置时默认开启，已有明确关闭选项保留。保存后正常退出再重新打开；隐藏到托盘不算退出，不自动重启或重建窗口。

### 必须说明的边界

采集保护不是完全隐身。框选截图仍有已知单帧/任务栏暴露限制；不能承诺所有会议软件、录屏方式或平台都不可见。请用无敏感内容检查实际接收端画面。此前两个原生透明度刷新方案因显示异常被撤回，本次不把这些方案包装成已修复功能。

界面测试需要覆盖选中文字浮动操作、每个按钮、重复点击、取消/关闭、滚动、切换会话、资料库开关与透明度变化，并区分通过、失败和未运行。真实音源、付费 API、模型准确率及特定录屏兼容性只在实际执行后报告。发布前以最终提交对应的测试和构建结果为准。

## English

This update targets the working application, not an image presented as usable software. UI changes must preserve the real transcription, answer, screenshot, session, settings and document-library flows. Demo transcripts or answers must not be fabricated, and UI checks are not proof that a live provider works.

### What changed in the interface

- Restrained neutral glass styling for light/dark themes, subtle borders, rounded transcript bubbles and compact buttons; colored left rails on answer cards are removed.
- The panel-background slider and 0.55 default remain. Native whole-window opacity is unchanged, and body text—including live transcript text—is not faded with its container.
- Per-bubble Translate/Answer actions remain directly visible. The floating selected-text action still answers the selection; it rereads a valid selection within the transcript pane at submission, rather than sending cleared or cross-pane stale text. This does not add a floating Translate action.
- Top controls and status information wrap in narrower windows. Current protection, next-launch preference and pending state remain separate, with keyboard-focus styling and reduced-motion support preserved.
- Only production styles and the selection guard were migrated; no simulated content, demo request logic or remote fonts were copied.

### Preserved capabilities

- System audio and an independent microphone channel, per-question answers, continuous answering, translation and screenshot Q&A continue to use the configured backends.
- Sessions, resume/JD material, deletion undo, text export and the optional multi-document library keep their existing data flows. The library defaults to OFF; enabling it downloads a model and consumes local resources. Retrieved snippets are sent to the configured answer provider.
- Panel-background transparency stays separate from text/control readability. Whole-window opacity is not a substitute, and a static screenshot alone cannot prove that live presentation remains responsive.
- Protection changes remain **next-launch only**, with current runtime state shown separately from the saved preference. New/missing preferences default to ON; explicit OFF choices are preserved. Quit normally and reopen after saving; hiding to the tray does not apply changes. No automatic restart or window recreation.

### Verification boundaries

Capture protection is not universal invisibility. Region selection retains a known one-frame/taskbar exposure limitation. Test the recipient view with harmless content in the actual sharing/recording application. Two earlier native-opacity refresh approaches were withdrawn after presentation failures; this update does not claim they are repaired features.

Acceptance must cover selected-text floating actions, every button, repeated clicks, cancellation/dismissal, scrolling, session changes, library controls and transparency changes. Report passed, failed and unrun checks separately. Physical audio, paid APIs, model accuracy and recorder-specific compatibility require actual verification. Publication depends on checks and artifacts for the final source commit.
