# T18 User Stories — Coding Capability Executor Host

> 用户故事只规定可观察结果与 Safety，不固定 Provider 推理、命令、文件组织或代码文本。

## A. 发现与启动

### U1 发现 Coding Capability

用户或外部 Agent 从 sitemap/capability entity 发现 `coding.execute` 的意图、输入、输出、风险和适用 Flow，不依赖 README 或 Provider 名。

验收：schema 完整；Application 合同不出现 Codex/Claude/Hermes；未授权 scope 零泄露。

### U2 在业务节点启动实施

用户在 `implementation-ready` 执行 `start-implementation`，系统生成 Run 并进入 running，而不是同步等待 Coding Agent。

验收：action-backed；source event/rel/action/principal 双向关联；启动重试不重复 Run。

### U3 Provider 由服务端选择

同一 action 在不同部署 profile 可使用不同 Coding Agent，Application 无需修改。

验收：请求中的 provider/binary/model/sandbox/yolo 被拒；receipt 记录实际选择与版本。

### U4 安全解析 Repository

请求只提交 `repositoryRef` 和 baseRevision，系统从 registry 解析授权仓库并建立隔离 workspace。

验收：任意路径、`~`、环境变量、跨 scope repositoryRef 拒绝且不创建 worktree。

## B. Durable Execution

### U5 实时查看进度

用户可看到 Run queued/preparing/running、命令、文件变化、测试和预算摘要，并能展开 raw events。

验收：normalized/raw seq 有界递增；raw payload redacted；Business hash 不因进度变化。

### U6 进程中断后恢复

worker 或 executor 中断后，新 worker 从 Run/native session/workspace/cursor 继续。

验收：不重复已确认命令/result；worktree 保留；最终轨迹连续或明确记录 restart boundary。

### U7 取消运行

用户执行 cancel 后 Temporal cancellation 终止子进程，Run 进入 cancelled，workspace/轨迹保留待审计。

验收：重复 cancel 幂等；取消后不产生成功 artifact 或 Flow on-done。

### U8 预算耗尽诚实失败

超时、turn、输出或成本预算耗尽时 Run failed，并提供可行动原因。

验收：无无限重试；无半 result；人工 Renderer 和其他运行保持可用。

### U9 Provider 缺失或未认证

Executor binary/SDK/认证不可用时，Run 在 workspace 修改前失败。

验收：不 fallback 到另一个 Provider；不伪装成功；错误和 probe evidence 留痕。

### U10 Execution Approval 独立

Executor 请求超出已授予工具/网络/路径时进入 waiting-approval 或拒绝，但这不等于接受最终代码结果。

验收：Agent 不能自批；execution approval 只扩大该 Run 的具体资源，不授予 merge/activate。

## C. Result Governance

### U11 生成完整 Coding Result

成功 Run 返回 patch、base/head revision、commits、changed files、tests、trajectory 和 summary artifact。

验收：hash 可复算；changed files 与 git diff 一致；tests 来自实际命令与退出码。

### U12 批准前零 Active 影响

Run succeeded 后 Flow 进入 review-ready，但主 checkout、主分支、Active definition 与业务事实不变。

验收：批准前 hash 对拍；worktree 是唯一写入面；Sidecar/Draft/Business 各自隔离。

### U13 人类接受结果

人类执行 accept 后，系统重新校验 base/current、路径、tests 和 artifact integrity，记录 accepted receipt。

验收：Coding Agent accept 100% 拒绝；首切片不自动 merge/push/deploy。

### U14 人类驳回结果

人类 reject 后保留 workspace、artifact、reason 和轨迹，Flow 进入 rejected。

验收：历史可重放；可以基于旧 Run 明确启动新 Run，但不能修改终态 Run。

### U15 Base 漂移

Run 期间 repository base 变化时 accept 转 stale，并要求 rebase/new Run。

验收：stale overwrite 为零；diff 指明 expected/current；旧 artifact 不被篡改。

### U16 并发隔离

两个 Run 同时修改同一 repository 时拥有不同 worktree/branch/lease。

验收：互不污染；相同 base 可并行；接受阶段 CAS 决定冲突而非最后写赢。

## D. Provider-neutral 与真实 Story

### U17 Codex Reference Adapter

真实 Codex 在隔离 fixture repository 完成小型代码任务并运行测试，UI4A 获得 native thread、JSONL trajectory 和结果 artifact。

验收：真实二进制/认证；无 fake driver 冒充；Provider/version/commands/tests 记录。

### U18 Adapter Contract 可替换

fixture Claude/Gemini adapter 以不同 raw event 形状通过同一 normalized contract。

验收：kernel/Flow/Renderer 测试无需 Provider 分支；未知 event 保留 passthrough 且不破状态。

### U19 不可 Resume 的 Provider

Provider 无 resume 能力时，UI4A 明示 restart strategy 并重新观察 workspace，而不是伪造 native continuation。

验收：receipt 标注 resumed/restarted；重复 result 被 commandId/CAS 去重。

### U20 Hermes 启发边界

架构保留 Agent Runtime/Workspace Backend/session/trajectory/profile 分层，但产品源码、依赖、配置和测试不安装或调用 Hermes。

验收：source governance 零 Hermes runtime import/command/config；架构文档允许未来 adapter。

### U21 人类 Renderer 可操作

人类可从软件变更实体启动、查看进度、取消、查看 diff/tests/trajectory 并接受/驳回。

验收：全部交互 action-backed；移动端可读；raw trajectory 不阻塞摘要面。

### U22 真实 Coding Agent Golden Story

真实 Codex 只获得五种自然语言目标之一、task envelope 和隔离 workspace，完成：start → progress → edit/test → result → Agent accept denied → human accept/reject → replay。

验收：canonical + 4 variants ≥80%；Safety 100%；不固定命令/代码/措辞；失败变体可恢复且不污染主 checkout。

