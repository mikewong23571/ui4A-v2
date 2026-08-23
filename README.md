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
- Meta BIOS：http://localhost:3100/meta
- Temporal UI：http://localhost:8233
- 健康检查：http://localhost:3100/api/health

停止完整栈使用 `Ctrl-C`；需要同时停止 PostgreSQL 时运行 `pnpm infra:down`。

## 当前产品边界

- 生产 Assistant 是 AI-first：default/auto 使用外部配置的真实 LLM，不 fallback 到 rule driver。模型不可用时诚实失败，人工 Renderer 仍可使用。
- 阅读、总结、比较和解释是 Agent 原生认知，不注册 application capability。publishing Application 不再包含摘要 artifact/action。
- Chat 只发送薄 Presentation Request；Application Recipe、用户级 Sidecar、Surface validation 和 A2UI hydration 位于独立 Presentation Plane。
- App 创建暂不在产品 Chat 内闭环。候选方向是外置 Agent 起草 Application Bundle，再通过 meta 合同接受机械校验、diff、human approval、激活和 replay。
- `ui4a` CLI 已作为协议参考客户端落地。外部 Agent 可发现/读取/操作合同，并把 Flow 候选
  提交为系统内 Governed Draft；CLI 不含 LLM，也没有审批、身份伪造或 raw write 入口。

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
- `apps/web`：HTTP 合同、PostgreSQL adapters、运行时编排、Chat、Renderer、Meta BIOS 和 Canvas。
- `apps/worker`：Temporal workflows 与 I/O activities。
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
