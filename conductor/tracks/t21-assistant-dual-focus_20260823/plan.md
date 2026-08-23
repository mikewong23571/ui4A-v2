# T21 Assistant 双焦点事实与 AI-first Presentation 一致性 — Plan

> 遵循 `conductor/workflow.md` 的 spike-informed Story TDD。验收用户结果，不固定模型措辞或工具
> 轨迹；禁止关键词路由、rule fallback 和客户端状态成为业务权威。

## Phase A: Red Baseline 与 Disposable Probes [checkpoint: ee0f922]

- [x] Task: 建立 U1–U8、Golden Story、Safety 和 evidence schema，记录 `lastNavigation`、`clientView`、LLM decisions、Presentation receipts、客户端 URL、事件增量及 Business Snapshot hash 7ac1349
- [x] Task: 用当前开发栈复现并自动化“详情 → 数量 → 列表 → 当前在哪”红线，证明 Agent `currentRel`、最近导航和客户端可见页面发生分叉 b50a929
- [x] Task: 运行 disposable LLM protocol probe，比较当前 provider 的 `toolChoice:auto`、强制工具调用和有界 LLM repair；记录延迟、成功率、无调用及异常形状，probe 代码不进入产品实现 4350be1
- [x] Task: 对双事实事件形状、客户端实例、刷新、直接页面进入、异步 Presentation receipt 和重放做 disposable contract probe 82d1dcc
- [x] Task: 根据 probes 编写 `user-stories.md`、`technical-stories.md`、`architecture.md`，并在 `DECISIONS.md` 记录双事实、不机械裁定冲突和协议修复边界 ee0f922
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) ee0f922

## Phase B: 双事实合同与事件投影 [checkpoint: 746c78d]

- [x] Task: Red TDD——定义 `lastNavigation` 与 `clientView` 的类型、provenance、unknown、客户端实例隔离和不可互相覆盖语义 e27cef7
- [x] Task: Green——在现有 Chat/Agent 边界实现最小共享合同，不新增存储或破坏 `shared ← engine ← agent` 853cc5e
- [x] Task: Red TDD——覆盖 navigation、Presentation receipt、client observation 的 append-only fold、乱序、重复、刷新和空投影重放 60900de
- [x] Task: Green——实现双事实事件及纯投影；验证 Business Snapshot hash 不变，客户端观察不能扩大读取或 effect authorization 69e8fc3
- [x] Task: 增加 source-governance 测试，阻止双事实再次折叠成单个 `currentRel`，并阻止客户端 route 成为业务授权来源 746c78d
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 746c78d

## Phase C: Chat、Canvas 与 Presentation 接线 [checkpoint: 75ed8ee]

- [x] Task: Red TDD——客户端每次发送消息时上报有界 `clientView`；覆盖 Canvas focus、Sidecar receipt、集合、详情、直接页面和 unknown 979880e
- [x] Task: Green——在 Next.js 当前版本约束下实现客户端观察采集与 Route 校验；不解析自然语言，不增加页面清单 ab59eb0
- [x] Task: Red TDD——成功 navigation 与可用 Presentation receipt 更新 `lastNavigation`；失败、pending、superseded receipt 不得冒充成功 e284cbd
- [x] Task: Green——接入 SSE、异步 Broker receipt 和 conversation projection，使下一轮 LLM 同时获得两个事实 a9c543b
- [x] Task: Red→Green——刷新、重连、切换历史会话和并发客户端保持各自 `clientView`，同时从日志恢复 `lastNavigation` 75ed8ee
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 75ed8ee

## Phase D: AI-first 决策与协议韧性 [checkpoint: 397c778]

- [x] Task: Red TDD——Prompt 明确区分合同读取位置、`lastNavigation`、`clientView` 和 Presentation subject；“每次决策一个调用”不得被模型误解成“每个用户回合只能一个调用” 68b72eb
- [x] Task: Green——向 LLM 披露有界双事实和 provenance，保留其自主选择 `answer`、`clarify`、`navigate` 或 `present` 的能力 a9c543b
- [x] Task: Red TDD——验证同一用户回合可完成 Presentation/navigation 后继续 answer，且每个 LLM decision 仍只有一个协议调用 0633570
- [x] Task: Red TDD——注入 text-only、未知工具、无效参数和 provider error；验证选定的强制工具/有界 LLM repair 策略 af3c493
- [x] Task: Green——实现 probe 证明可行的最小协议修复；禁止正则、关键词、文本转操作和 rule driver fallback，修复失败诚实终止 f33db75
- [x] Task: 增加产品源码治理测试，阻止“看看/列表/详情”等短语进入 Chat Route、Agent driver 或客户端导航分支 397c778
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 397c778

## Phase E: Golden Story 与 Track 收口

- [x] Task: 实现真实浏览器 Golden Story：“看看第一篇文章 → 总共有几篇 → 我要看看列表 → 我现在在哪”，断言每步 Canvas/URL、双事实 prompt、receipt 与回答来源 5dc688d
- [ ] Task: 运行 canonical + 四种自然语言变体；canonical 浏览器完成率 100%，变体用户结果成功率 ≥80%
- [ ] Task: Safety Gate——全链业务 mutation、错误对象、越权读取和 effect authorization 增量均为 0；Chat/Presentation/focus provenance 100%
- [ ] Task: 运行 focused Vitest、`pnpm check`、相关 `CI=true pnpm e2e`、真实 LLM Eval 和 live `pnpm dev:all` walkthrough
- [ ] Task: 同步 `GOAL.md`、`conductor/product.md`、`conductor/refs/arch-brief.md`、`DECISIONS.md` 与 Track evidence/DONE；不修改技术栈
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
