# UI4A v2 — 实现项目

本目录的目标：从零实现 UI4A v2 架构的完整应用。设计已完成，技术选型已定，按图纸施工。

## 快速开始

```bash
# 1. 安装依赖(pnpm workspaces:apps/web + apps/worker + packages/*)
pnpm install

# 2. 可选：在根目录 .env.local 中配置 LLM_API_KEY、LLM_BASE_URL 和 LLM_MODEL

# 3. 一键启动 PostgreSQL + Temporal + worker + web
# PostgreSQL 后台运行；其余进程由 concurrently 统一管理，Ctrl-C 一起停止
pnpm dev:all
```

打开 <http://localhost:3100>:态势投影(待确认/在飞委托/文章数)+ 事件流 + 各入口;健康检查 `/api/health`。`pnpm dev:all` 会加载根目录中 gitignored 的 `.env.local`，并将其中配置同时传递给 web 和 worker。外部已设置的环境变量优先，可用 `pnpm env:verify-dev` 在不输出变量值的前提下验证传递链路。

停止后如需同时关闭 PostgreSQL，运行 `pnpm infra:down`。

质量门与 E2E:

```bash
pnpm check          # typecheck(全 workspace)+ eslint + vitest(821 单测)
CI=true pnpm e2e    # Playwright 全量(43 用例:B1–B4/S1–S5/I1–I6/双执行者)
CI=true pnpm e2e invariants   # 不变量套件单跑(I1–I6)
```

- **Demo 走查**:[conductor/demo-checklist.md](./conductor/demo-checklist.md)(人工走查脚本,含四个评估点);
- **DONE 对照**:[conductor/done-report.md](./conductor/done-report.md)(GOAL 逐条证据);
- 其他常用命令见 `conductor/workflow.md` 的 Development Commands。

## 必读文档（按顺序，位于 `docs/`）

1. **`docs/UI4A-v2（重排版）：界面作为合同，应用作为数据，能力作为边界.md`** — 架构正典。
   两个锚点立起全文：人机共享同一套业务流程知识；为 AI 能更好地操作软件而写软件。
   - 第一至四部：论证与已验证的实现（原 demo 为 Clojure，已按选型迁往 TypeScript，架构经验 1:1 平移）；
   - 第五部：五条垂直切片 = 施工顺序；尚未解决的洞 = 已知风险清单；
   - 附录 A：`_meta` 的实体规格（最小核 + 编辑动词 + 激活不变式 + BIOS）。
2. **`docs/UI4A-技术选型.md`** — 全部用社区轮子，不自造。栈一句话：

   > **XState 定义业务流，PostgreSQL append-only 存事件，Siren 投影合同，Cedar 裁决权限，Keycloak（RFC 8693）发委托，Temporal 跑能力与委托（durable execution），AI SDK + assistant-ui 聊天，A2UI 作渲染协议，RJSF 哑兜底，shadcn 拼骨架——自己只写投影、裁决和平面组装那层胶。**

   选型含 agent 接口决策（1.1 节）：固定协议动词工具 + 每状态动态生成的动作工具，不自造线协议；HTTP 合同是唯一真相，tools/MCP 是投影。

## 施工顺序（来自架构文档第五部"闭环自审"）

1. **确认门切片**：guard 挂起语义 + pending 确认实体 + notify（Temporal activity）+ 收件箱；Cedar 风险策略；actor/principal 入日志。
2. **最小 meta 切片**：flow 定义从代码挪进事件日志（XState machine-as-JSON）+ definition-lifecycle + 激活不变式 + 机械 diff + RJSF/Stately 做 BIOS。
3. **委托实体切片**：agent 执行迁入 Temporal workflow——崩溃续跑、N 路并行、舰队队列页免费获得。
4. **plan-exec 切片**：批量裁决计划，一次决策、机器速度执行。
5. **骨架与渲染切片**：widget 画布 + 渲染词汇表（TanStack Table / shadcn Charts / Tremor / react-chrono / React Flow / dnd-kit，注册为 A2UI 扩展目录）+ 主页态势投影。

## 不可违背的五条铁律

1. **AI-optional**：机械层零智能时必须完整工作；AI 只改善体验，不承担正确性（三处 AI，三处哑兜底）。
2. **binding-only**：模型只发引用不发内容——渲染器从实体缓存解引用，模型发不出一个数字。
3. **交互必须 action 背书**：任何可点的按钮必须绑定到已声明 action，提交经引擎裁决。
4. **事实永不发明**：字段的值来源必须声明（默认/查找/引出/效果产出/意图/起草+选择），agent 猜只对价值载体字段合法且过选择门。
5. **审批不委托**：`approve` 永远 `actor-is-human`；审计渲染（事件流、机械 diff）路径零 AI。

## 状态基线

- 业务平面（引擎 + 三层裁决 + Siren 投影 + 双 driver agent + 悬浮聊天）已在原 demo 中端到端验证（Clojure 实现，见架构文档第五部实测记录与调试教训）；
- 待实现：定义平面、能力平面、信任线、交互层、渲染层——即上列五条切片；
- 顶层旧目录 `../ui4A` 保留全部历史文档与 Clojure demo 作参考，不在其中继续开发。
