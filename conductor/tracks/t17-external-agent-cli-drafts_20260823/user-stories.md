# T17 User Stories — External Agent CLI 与 Governed Draft Ingress

> 用户故事只规定可观察结果、Safety 和证据，不规定第三方 Agent 的模型、推理、命令顺序或补丁风格。CLI 的确定性协议测试不能替代真实第三方 Agent Eval；真实 Agent Eval 也不能替代机械安全门。

## A. 安装、身份与发现

### U1 从任意目录连接 UI4A

第三方 Agent 在非 UI4A 仓库目录运行 `ui4a --json doctor`，应得到 CLI/协议版本、endpoint、认证来源和可行动的缺失配置。

验收标准：命令不依赖 cwd；缺认证仍返回合法 JSON；stdout 无诊断文本和 secret；网络/协议错误非零退出。

### U2 发现 Application 与合同入口

Agent 应发现授权 Application、intent、Flows、入口、实体集合和协议版本，而不依赖 README 或业务关键词。

验收标准：结果来自 sitemap/Siren；默认结果有界；未授权 app/rel 的存在和数量不泄露。

### U3 读取精确 Entity 与实时动作

Agent 用稳定 rel 读取 Entity，应获得 properties/actions/links/guard-results，并能继续 resolve links。

验收标准：显示值与 HTTP 合同逐字段一致；CLI 不缓存 enabled/blocked；未知 rel 结构化失败。

### U4 导出可编辑 Application Bundle

Agent 导出 `publishing` Bundle，应保留 app/flow membership、definition versions、schemas、guards、effects、policies 和 provenance。

验收标准：export → parse → canonical export 等价；不导出运行中 hydrated facts、secrets、Session 或 Sidecar。

### U5 查看原始轨迹

Agent 按 session/entity/definition/draft anchor 读取有界事件链，应看到原话、decision prompt/reasoning、operations、rejections、approval 和 effect provenance。

验收标准：事件顺序、seq、kind、detail 原样；reasoning 缺失为 null；分页 cursor 可继续。

## B. 业务系统操作

### U6 执行受权低风险 Action

Agent 发现并执行合同声明为 direct 的低风险 action，系统应正常裁决和投影结果。

验收标准：参数按实时 schema；只产生预期业务 effect；actor/principal/agent/channel/commandId 留痕。

### U7 提交字段内容进入 Draft

Agent 对默认 draft 的可写内容提交修改，系统应返回 Draft Entity，而不是立即覆盖目标事实。

验收标准：Active Snapshot hash 不变；Draft 带 target/baseVersion/provenance；业务集合不把 Draft 当正式成员。

### U8 高风险 Action 进入 Confirmation

Agent 执行高风险状态 action，系统应使用既有 pending confirmation，而不是自动批准或无意义重复套 Draft。

验收标准：批准前业务状态不变；Agent approve/reject 被拒；人类决定后 effect 与审计一致。

### U9 根据拒绝修正业务请求

Agent 收到 guard/schema/undeclared 拒绝后，应能读取结构化原因、重新观察当前 Entity 并修正请求。

验收标准：拒绝入日志；错误含 layer/reason/detail；不要求固定恢复轨迹；未授权副作用为零。

### U10 批量计划仍逐步裁决

Agent 提交 exec-plan 时，每一步仍按 declaration/guard/schema 裁决，失败或挂起有分步报告。

验收标准：计划不获得额外权限；approve/reject 不可放入 Agent plan；重试幂等。

## C. Draft 系统内缓冲带

### U11 无效候选也能进入系统修订

Agent 创建 envelope 合法但 payload 不完整的 Application/Flow Draft，系统应保存为 invalid 并返回问题，而不是把制品留在系统外。

验收标准：invalid Draft 可读、可修订；Active truth 不变；非法/超限 envelope fail-closed 且不落 payload。

### U12 修订同一个 Draft

Agent 根据 validation issues 修订 Draft，应产生 immutable 新版本并移动 active pointer。

验收标准：旧版本不可变；baseVersion CAS；两个并发冲突写恰一成功；commandId 重试不重复。

### U13 机械校验与修复

Agent 触发 validate，应得到与真实 activation 相同的 schema/invariant/registry 结果，并能修复到 ready。

验收标准：CLI 不实现规则副本；每个 issue 有 code/path/message/evidence；同输入结果确定。

### U14 查看候选结构 Diff

Agent 和人类查看 Draft 与当前 Active 定义的 diff，应看到完整机械差异。

验收标准：diff 不经 LLM；字段/节点/action/guard/effect 删除和新增不丢；事实 payload 与审计字段分层。

### U15 提交待审批候选

ready Draft submit 后进入 pending-approval，并返回 activation rel；Agent 可以 watch，但不能继续静默修改 pending 版本。

验收标准：submit 幂等；Active Snapshot/sitemap/Recipe 不变；后续 revision 显式派生新 Draft 版本或退回 editing。

### U16 人类批准并原子应用

人类批准 Draft 时，系统重新授权、校验和检查 baseVersion，然后原子激活定义。

验收标准：Agent approval 100% 拒绝；批准后 sitemap version bump；新实例使用新定义；旧实例遵守出生版本；无半激活状态。

### U17 拒绝、放弃和继续修订

人类 reject 或 Agent abandon Draft 后，payload、版本、reason 和 provenance 保留；reject 后可显式 fork 新 revision。

验收标准：终态不可直接 submit；历史可重放；abandon 不删除审计或 Active Entity。

### U18 漂移与 Rebase

Draft editing 期间 Active target 已变化，validate/approve 应标记 stale，并要求 Agent 读取新版本后 rebase。

验收标准：stale overwrite 为零；diff 指明 base/current；rebase 产生新 payload hash 和 provenance。

## D. Submission Policy 与边界

### U19 Agent 无法取消合同要求的 Draft

第三方 Agent 即使传入 raw JSON、flag 或伪造 actor，也不能把 `mode=draft` 改为 direct。

验收标准：策略从激活定义/授权处境求值；请求端 override 被拒并留痕；CLI 无 `--no-draft`。

### U20 Direct 是显式合同例外

维护者为低风险 action 激活 `mode=direct` 后，受权 Agent 可直接执行；定义修改本身仍需审批。

验收标准：未声明策略默认 draft；direct 仍走完整 judgment；作用域外 Agent 被拒。

### U21 衍生 Entity 不进入 Draft

统计、搜索结果、sitemap、Siren projection、审计时间线等 Entity 使用 `mode=none`，不创建 Draft 也不暴露写 action。

验收标准：property/source fuzz 覆盖 direct/member/nested/derived；系统内部 fold 可重建投影；外部写一律拒绝。

### U22 Presentation 与 Draft 不混淆

Agent 优化 UI 时只修订用户 Sidecar；Agent 修改业务内容或定义时进入 Draft。

验收标准：Sidecar 不进入业务集合；Draft 不进入 Presentation fastpath；两类事件和 provenance 可分别重放。

## E. 第三方 Agent Golden Story

### U23 CLI 安装和稳定 JSON

维护者安装 CLI 后，应从 `/tmp` 完成 help/doctor/discovery/read/dry-run，且所有 JSON shape 和 exit code 稳定。

验收标准：`command -v ui4a` 成功；无源码 cwd 依赖；token redaction；raw write 不存在或 fail-closed。

### U24 真实第三方 Agent 完善现有应用

真实第三方 Agent 只获得用户目标、CLI help 和授权凭据，完成 publishing Flow 改进 Golden Story：发现 → export → invalid Draft → 依据 rejection 修订 → validate → diff → submit → Agent approval 被拒 → human approve → 验证新定义与 replay。

验收标准：canonical + 4 自然语言变体成功率 ≥80%；不固定 Agent/模型/命令轨迹；Safety 100%；活动用户在批准前零影响；CLI/产品 runtime 无故事关键词或内置 LLM 分支。
