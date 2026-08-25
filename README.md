# UI4A v2 — 界面作为合同

UI4A 让应用用机器可读合同说明事实、关系、动作和约束，使人类 Renderer、脚本和外部 Agent 消费同一套业务真相。LLM 负责理解、回答与规划；引擎负责授权、schema、guard、确认、审计和重放。

## 快速开始

```bash
pnpm install

# 可选：根目录 .env.local
# LLM_API_KEY=...
# LLM_BASE_URL=...
# LLM_MODEL=...

pnpm dev:all
```

`pnpm dev:all` 统一启动 PostgreSQL、Temporal、Worker 和 Web。访问：

- 应用：http://localhost:3100
- Canvas：http://localhost:3100/canvas
- 事件与原始轨迹：http://localhost:3100/events
- Meta Human Control Plane：http://localhost:3100/meta
- Temporal UI：http://localhost:8233
- 健康检查：http://localhost:3100/api/health

停止完整栈使用 `Ctrl-C`；需要同时停止 PostgreSQL 时运行 `pnpm infra:down`。

## v0.1.0-experimental.1 现场状态

首个 internal experimental 版本已在 mothership 内网以单副本、非 HA 形态部署，可通过
`https://ui4a.mothership.internal:32067/` 访问。认证、单 Web 并发/重启/重放及十工件隔离恢复已
现场验证；最终 Compose 与 K8s Runtime 均诚实返回 `execute-failed`、无 fallback，U8 和 accept
仍 deferred。镜像扫描有 50 个 Critical、241 个 High matches，属于仅限内网实验的 `known-risk`；
rollback 与 fault injection 尚未实测。本版本不是 GA，不提供 SLA 或 LTS，也不适用于生产。
证据见 [release notes](./release/v0.1.0-experimental.1/RELEASE_NOTES.md)、
[acceptance report](./release/v0.1.0-experimental.1/acceptance-report.json) 和
[deployment runbook](./docs/t22-production-runbook.md)；仓库未创建对应 Git tag。

## 当前产品边界

- 生产 Assistant 是 AI-first：default/auto 使用外部配置的真实 LLM，不 fallback 到 rule driver。模型不可用时诚实失败，人工 Renderer 仍可使用。
- 阅读、总结、比较和解释是 Agent 原生认知，不注册 application capability。publishing Application 不再包含摘要 artifact/action。
- Chat 只发送薄 Presentation Request；Application Recipe、用户级 Sidecar、Surface validation 和 A2UI hydration 位于独立 Presentation Plane。
- App 创建暂不在产品 Chat 内闭环。候选方向是外置 Agent 起草 Application Bundle，再通过 meta 合同接受机械校验、diff、human approval、激活和 replay。
- `ui4a` CLI 已作为协议参考客户端落地。外部 Agent 可发现/读取/操作合同，并把 Flow 候选
  提交为系统内 Governed Draft；CLI 不含 LLM，也没有审批、身份伪造或 raw write 入口。
- `coding.execute` 将通用 Coding Agent 作为受治理 capability executor：Application 只声明
  软件变更 Flow；服务端选择 profile，UI4A 创建隔离 worktree，Temporal 持久运行，原始轨迹与
  patch/test result 留在 Capability Run。Codex 是 reference adapter；结果仍需人类接受，且首切片
  不 merge、push、deploy 或 activate。Hermes 仅是架构参考，不是运行时依赖。
- T19 将 executor 推广为版本化 Specialized Agent Contracts：`coding-agent@1`、
  `writing-agent@1` 与 `agent-definition-author@1` 共享 generic Agent Run/Temporal Host，但拥有不同
  Task/Result、runtime、resource backend 和 verifier。Authoring 的输出只进入 Draft，不能自批或自激活。
- T20 将既有 Meta 合同投影为 sitemap 驱动的人类控制台：Application、Agent Definition、Draft
  使用任务优先视图；未知 class 安全兜底；Scope、实时 action、人类审批、diff/Eval/replay 仍由
  机械协议治理，默认任务不要求阅读或编辑 raw JSON。
- T21 让 Assistant 同时理解最近成功导航 `lastNavigation` 与当前消息的客户端可见事实
  `clientView`；合同读取位置不再冒充页面。界面目标由真实 LLM 选择薄 Presentation/navigation，
  没有关键词路由；工具协议使用 required envelope 和至多一次真实 LLM repair。

## 文档权威顺序

1. [GOAL.md](./GOAL.md)：当前目标、DONE 与明确的范围边界。
2. [DECISIONS.md](./DECISIONS.md)：当前有效且可追溯的架构决定；后续决定 supersede 旧决定。
3. [conductor/product.md](./conductor/product.md)、[product-guidelines.md](./conductor/product-guidelines.md)、[tech-stack.md](./conductor/tech-stack.md)：当前产品与工程约束。
4. [conductor/refs/arch-brief.md](./conductor/refs/arch-brief.md)：面向实现的当前架构摘要。
5. `conductor/tracks/`：实施时的计划与证据，完成后作为历史记录，不自动代表当前方向。
6. `docs/`：原始架构论证与技术调研；其中被 T15/T16/D28 supersede 的段落仅作历史背景。

运行与审计说明：

- [运行手册](./docs/runtime-operations.md)
- [审计、原始轨迹与重放](./docs/audit-and-replay.md)
- [人工走查](./conductor/demo-checklist.md)
- [当前 DONE 对照](./conductor/done-report.md)

## 架构地图

```text
Human UI / External Agent / Script
               │ Siren + HTTP (`ui4a` is the reference client)
               ▼
apps/web ──► packages/engine ──► append-only PostgreSQL events
   │                  │
   │                  ├─ Business fold / judgment / projections
   │                  └─ pure Presentation kernel
   ├─ Presentation Broker / Sidecar projection / A2UI host
   └─ Temporal client ──► apps/worker ──► activities

packages/shared ◄── packages/engine ◄── packages/agent
```

- `packages/shared`：跨运行时定义和协议。
- `packages/engine`：纯业务内核与 pure Presentation kernel。
- `packages/agent`：AI-first Agent 协议、LLM driver、Presentation/Revision adapters；scripted/rule driver 仅是测试 fixture。
- `apps/web`：HTTP 合同、PostgreSQL adapters、运行时编排、Chat、Renderer、Meta Human Control Plane 和 Canvas。
- `apps/worker`：Temporal workflows 与 I/O activities；`src/agents/host` 是 generic lifecycle/transport，
  `coding`、`writing`、`authoring` 是通过 composition registry 接入的 specialization adapters。
- `apps/cli`：可安装的 `ui4a` binary、稳定 JSON envelope、发现/读取/业务动作/Draft/audit 命令。
- `apps/web/src/applications`：可安装 Application Bundle；不要在 route/service 中硬编码业务 Flow。

详细模块责任见 [AGENTS.md](./AGENTS.md)。

## 质量门

```bash
pnpm check                         # TypeScript + ESLint + Vitest
CI=true pnpm e2e                   # Playwright 全量套件
pnpm eval:t15                      # opt-in T15 真实 LLM Story Eval
pnpm eval:t16                      # opt-in T16 真实 LLM Story Eval
pnpm eval:t17                      # CLI/Draft safety、性能与 external-Agent evidence
pnpm eval:t18                      # 真实 Codex 5-variant Coding Capability Eval
pnpm eval:t19:writing              # 真实 Writing 5-variant + rubric + Safety Eval
pnpm eval:t19:authoring            # 真实 Agent Definition Authoring 5-variant Eval
pnpm format:check                  # Prettier
```

不要在文档中固化测试数量；以命令的现场输出为准。Vitest 使用隔离测试库，禁止把测试指向开发数据库。

CLI 安装与命令参考见 [`apps/cli/README.md`](./apps/cli/README.md)。

## 五条铁律

1. **AI-first、机械治理**：LLM 是认知主体；机械系统治理事实和副作用。
2. **Binding-only**：Surface 保存引用，不保存已解引用事实。
3. **交互必须 action 背书**：业务提交必须来自实时声明并经过引擎裁决。
4. **事实永不发明**：字段值与衍生结果必须保留来源。
5. **审批不委托**：`approve` 永远要求 `actor=human`；审计路径零 AI。
