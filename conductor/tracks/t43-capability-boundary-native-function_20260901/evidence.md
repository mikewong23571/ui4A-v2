# T43 验收证据

## Phase A — 用户故事、Red 基线与架构 checkpoint

日期：2026-09-01。Checkpoint functional commit：`8eb6e58e`。

### 自动化证据

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 当前 Function dispatch Red | disposable DB probe（见 `spike.md`） | exit 1，精确命中 `service.ts:481` Agent-only 缺口 |
| Engine effect/invariant 基线 | `pnpm vitest run --project unit packages/engine/src/execution/effects.test.ts packages/engine/src/definition/invariants.test.ts` | 55 passed |
| Agent dispatch DB 基线 | `pnpm vitest run --project db apps/web/src/engine/agent/native-agent-dispatch.test.ts` | 10 passed |
| Temporal durable probe | `pnpm vitest run --project unit packages/engine/src/execution/effects.test.ts apps/web/src/temporal/agent-run.test.ts apps/worker/src/agents/host/finalize.test.ts apps/worker/src/agents/host/temporal.integration.test.ts` | 4 files / 32 passed，含 SIGKILL 恢复与取消 |
| 全量门 | `UI4A_WORKER_HEALTH_PORT=3199 pnpm check` | 471 files / 3585 tests passed，6 skipped；strict governance green |
| 格式与 diff | Prettier + `git diff --check` | passed |

首次未覆盖健康端口的 `pnpm check` 因当前用户开发栈占用 `3101`，notify integration worker 以
`EADDRINUSE` 退出；没有测试断言失败。使用仓库支持的独立端口 `3199` 原命令复跑后全绿，没有停止
或修改用户开发栈。

### 自治人工等效检查

1. 对照 `product-vision.md`、T43 spec 与 S1–S14，确认普通用户只面对 Entity、Action、Work Thread
   与责任点，Native Function/Temporal 留在 Adapter/raw 边界。
2. 检查 D59 与 `architecture.md`：Capability 是 Port；Agent 继续唯一使用 canonical Agent Run；
   Function 以 spawn/outbox + terminal receipt 运行，不新建 Run。
3. 检查 Phase A diff：除 `DECISIONS.md` 与 Track 文档外无产品代码变更。
4. 检查依赖与治理：零新增 runtime dependency、workspace、数据库产品或例外。
5. 检查计划已吸收 probe 发现：outbox reconciliation、mixed-domain atomic finalize、partial unique
   index、hash collision、birth-pinned retry/timeout 和 network-denied reference handler 均已进入 Phase
   B/C/D 的 Red→Green 任务。

自治验收结论：Phase A 达成；进入 Phase B 前的不确定运行时、事务与幂等边界已经由 probe 和 D59
固定，没有把函数平台提升为产品概念，也没有恢复第二套 Run。

## Phase B — 纯合同、绑定与激活门禁 checkpoint

日期：2026-09-01。Checkpoint functional commit：`89dac9cc`。

### Red → Green 证据

| 边界 | Red | Green |
| --- | --- | --- |
| Deployment contract | module missing，suite exit 1 | 21 tests passed |
| Capability input binding | module missing，suite exit 1 | 13 tests passed，含 100 property runs |
| Activation invariants | 4 expected failures / 33 passed | 4 files / 88 passed |

Focused coverage：71 tests passed；statements 91.51%、branches 87.62%、functions 94.87%、lines
92.83%。`native-function.ts`、`capability-input-binding.ts` 与 `invariants.ts` 各项均超过 80%。

全量 `UI4A_WORKER_HEALTH_PORT=3199 pnpm check`：474 files passed、3624 tests passed、6 skipped；
typecheck、lint（仅既有 warnings）、strict governance 全绿。

### 自治人工等效检查

1. Profile、invocation、outcome、receipt 均是平台中立共享合同；Application 定义没有 endpoint、
   credential、handler module 或 Temporal 参数。
2. Binder 只接受 Action params、source entity 显式 fields 与已授权 artifact refs；property test 证明额外
   source fields 不进入 payload。
3. Native Function 激活要求 input/output schema、可用 handler profile、封闭 binding 与 internal
   success/error callbacks；Function 不携带 Agent Definition，Agent 仍必须携带 exact Definition。
4. 新增测试沿 `definition/capability-boundary/` 拆分，GR3 零例外；没有 renderer/service 重复判断。

自治验收结论：Phase B 达成；Capability Port 的输入、部署需求和回流入口已在 pure/activation 层
fail closed，可进入 Web/Worker 执行组合。
