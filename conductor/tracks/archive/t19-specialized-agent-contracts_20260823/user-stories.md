# T19 User Stories — Specialized Agent Contracts

> 用户故事验收观察 Agent 的开放结果、资源边界和治理结果，不固定思维链、工具顺序、命令、
> 文本措辞或 artifact 内容。机械系统只验权限、合同、证据、状态和重放。

## A. 发现与本体分层

### U1 发现特化 Agent

用户或外部 Agent 能发现当前 scope 可用的 Agent specialization、intent、输入输出和所需资源。

验收：Coding/Writing 可区分；不需要 README；不披露 Provider secret/endpoint。

### U2 Capability 与 Agent 解耦

Application Capability 说明业务目标，Agent Definition 说明执行专业化，Runtime Profile 说明部署。

验收：三者有独立 ref/version；替换 runtime profile 不修改 Application Bundle。

### U3 Coding Agent 是首个实例

现有 Coding Agent 作为 `coding-agent@1` 出现在 registry，而不是 Host 内的硬编码特例。

验收：T18 用户故事与真实 Eval 无回归；generic modules 不判断 `coding.execute` 名称。

### U4 Writing Agent 是第二个实例

Writing Agent 使用不同 prompt、task/result、resource policy 和 verifier 完成写作工作。

验收：不要求 Git patch/test；不导入 Coding runtime；输出文档与引用/渲染证据。

### U5 即时认知不创建 Run

用户只问阅读、总结、比较、解释时，Chat Agent 直接回答，不因 Agent registry 而自动物化 Run。

验收：零 agent-run/artifact；只有 durable/tool-using work 才显式启动 Run。

## B. 定义一种特化 Agent

### U6 声明 Prompt Template

作者用 typed blocks、roles 和 bindings 声明专业 Prompt，而不是修改 Agent Host 源码。

验收：模板内容寻址；变量全集可从 schema 解析；未知变量激活失败。

### U7 声明 Task Contract

作者以 JSON Schema 定义 Agent 接受的任务字段、必填项和大小边界。

验收：Renderer/Agent/HTTP 使用同一 schema；非法输入在 Run 创建前拒绝并留痕。

### U8 声明 Result Contract

作者定义 response/artifact/evidence/proposed-effect 的专业结果 schema。

验收：Provider final 未过 schema 不成为 succeeded result；raw trajectory 保留。

### U9 声明 Runtime Requirements

作者声明 runtime class 与必要 features，不指定具体 Provider、binary、endpoint 或 key。

验收：部署 profile 匹配才可激活/运行；请求覆盖与 fallback 均拒绝。

### U10 声明工具和资源策略

作者声明可请求的工具/资源类别；principal grant 和 Application action 进一步收紧。

验收：Agent 可动态组合授权工具；未声明 filesystem/network/secret/CLI 请求零执行。

### U11 声明 Artifact 与 Evaluation Policy

作者声明允许的 artifact 类型、verifier、质量 rubric 和安全门。

验收：机械 Safety 与动态质量分离；Agent/LLM judge 都不能替代 human approval。

### U12 从基础定义派生

作者可从已激活基础 Agent Definition 派生特化版本并覆盖允许的 contract sections。

验收：激活时 flatten；缺父版本/循环/禁止覆盖失败；既有版本不受父定义后续变化影响。

## C. 运行特化 Agent

### U13 从业务 Action 启动

用户执行声明 action，系统按 Agent Definition 创建 `agent-run:<id>` 并异步返回。

验收：source/action/principal/authorization 双向关联；重复请求不重复 Run。

### U14 动态完成开放任务

Agent 根据 objective、上下文和授权资源自行规划与组合工具，不依赖固定轨迹。

验收：相同故事允许不同步骤/措辞；结果按 rubric 而非 exact snapshot 验收。

### U15 请求澄清

任务信息不足时 Agent 返回 `needs-input` 和 typed questions，用户回答后从同一 Run 继续。

验收：不猜必填事实；问题与回答入日志；恢复保留 definition/prompt birth version。

### U16 请求执行资源

Agent 需要额外工具、网络或目录时进入 waiting-approval，而不是修改 task/profile。

验收：批准只扩展该 Run 的具体 grant；拒绝可恢复；结果批准仍是独立事件链。

### U17 中断、取消与恢复

Worker/Provider 中断后从 session/workspace/cursor 恢复；用户取消后终态可审计。

验收：真实 Temporal kill/cancel；零重复 result/callback；不支持 resume 时明确 restart boundary。

### U18 返回契约化结果

Agent 返回专业 result envelope、artifacts、evidence、questions 和 provenance。

验收：definition/prompt/runtime/task/result hashes 可复算；缺 evidence 不能伪装成功。

### U19 结果进入应用治理

Result 只是一项 proposal；目标 Application 决定 Draft、accept/reject、confirmation 或只读使用。

验收：Agent 不能自行写 Active truth；所有 proposed effect 重走实时 action 裁决。

## D. 两个真实 Specialization

### U20 Coding Agent 无回归

用户提交受约束的软件变更，Coding Agent 在 worktree 修改/测试并返回 CodingResult。

验收：T18 5 variants、Safety、main checkout、human no-merge receipt 全部保持。

### U21 Writing Agent 完成真实 Brief

用户提交 brief、audience、sources、format，Writing Agent 生成可读文档并给出来源与 render evidence。

验收：canonical + 4 variants ≥80%；不存在的来源零引用；不修改代码或自动发布。

### U22 Runtime 差异真实存在

Coding 使用 workspace/Git/test resources；Writing 使用 document/artifact/source/render resources。

验收：两个 Definition 共享 Run Host，但 resource backend/verifier 不同；任一 specialization 不依赖另一方。

## E. Agent 创建 Agent

### U23 Agent 起草 Agent Definition

用户描述一种新专业 Agent，现有 Agent 生成 prompt、schemas、runtime requirements、policies、examples
和 Eval corpus，作为系统内 Draft。

验收：canonical + 4 phrasings 至少 4 个 Draft 可机械验证；不要求固定定义文本。

### U24 机械验证和 Eval

系统检查 schema、template bindings、inheritance、runtime features、tools、budgets、verifiers 和 Eval。

验收：全部 checks 可见；动态质量使用真实 Agent corpus；Safety 必须 100%。

### U25 Agent 不能批准自身

起草 Agent 或其他 Agent 尝试 approve/activate Agent Definition 时被拒并留痕。

验收：actor=agent/system 均拒；仅 human decision 可推进 active pointer。

### U26 版本升级和重放

人类批准新版本后新 Run 使用新定义，旧 Run 继续引用出生版本；完整历史可重放。

验收：registry/sitemap bump；旧 prompt/result 不漂移；空投影重建 hash 一致；并发批准由 CAS 决定。
