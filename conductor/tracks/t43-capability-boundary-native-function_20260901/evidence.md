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
