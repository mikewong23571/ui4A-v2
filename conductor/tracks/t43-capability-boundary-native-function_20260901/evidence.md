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

## Phase C — Web/Temporal/Worker/DB 执行闭环 checkpoint

日期：2026-09-01。Checkpoint functional commit：`6fdd581b`。

### 自动化与真实运行证据

| 证据 | 结果 |
| --- | --- |
| Dispatcher/Profile/Temporal client/Reconciliation | class-based dispatch、fail-before-append、birth detail、deterministic workflow ID 全绿 |
| Worker Adapter | registry、double schema/hash/bytes、retryable/permanent、cancel、profile drift 全绿 |
| Governed Finalize | success、forged birth、invalid output、stale guard、effect origin 全绿 |
| DB receipt transaction | receipt+core atomic、dedup、collision、rollback、partial unique index 全绿 |
| Real Temporal | 2 stories passed：Worker SIGKILL retry/finalize once；cancel 后 finalize 且 Workflow CANCELLED |
| Real PostgreSQL outbox | persisted orphan 启动；terminal receipt 后不再派发 |
| Full check | 484 files passed、3657 tests passed、6 skipped；strict governance green |

Focused coverage：55 tests passed；statements 84.9%、functions 88.05%、lines 86.68%。Reconciliation
unit 分支由真实 DB outbox test 补证。所有 workspace typechecks 与 worker workflows build 通过。

### 自治人工等效检查

1. Agent executor 仍走 exact Agent Definition + canonical Agent Run；Native Function 只按 executor class
   进入 Function Adapter，dispatcher 不读取 Capability/Application 名称。
2. `spawn-requested` 在同一 core batch 中保存 sealed birth；Temporal start 失败留下可重协调 outbox，
   不回滚已合法执行的 Application Action，也不新建 outbox 表。
3. Handler 只收到 payload、executionId、AbortSignal；无 DB/Web/Snapshot/credential/callback 选择能力。
4. Worker 与 Web 各自按同一 birth schema/hash/bytes 验证；成功 claim 仍须当前 callback Action 接受。
5. Terminal receipt 与 callback core events 同事务；advisory lock + partial unique index 处理 retry；stale
   callback 留拒绝事件且不覆盖当前状态。
6. 普通业务 fold 只消费 callback core events；Temporal history 与 capability receipt 不成为业务真相。

自治验收结论：Phase C 达成；本地 Function Adapter 已形成可恢复、可重放、可审计的受治理执行闭环，
可以进入真实 Security Application 垂直切片。

## Phase D — Security Application 真实垂直切片 checkpoint

日期：2026-09-01。Checkpoint functional commit：`40045813`。

### 真实双执行者闭环

隔离现场使用 Web `3200`、Worker health `3198`、独立 Temporal task queue 与临时
`ui4a_t43_acceptance` PostgreSQL database；未停止或修改用户当前 3100/7233 开发栈。验收后 Web/Worker
正常停止，临时数据库删除，生成 `.next-t43-acceptance` 已移至 Trash，可恢复。

1. **Human renderer/HTTP**：从 `cve:CVE-2026-0001` 的 `enrich-impact` Action 发起，先投影
   `enriching/正在补充影响信息`，随后 callback 推进 `enriched/影响信息已补充`。
2. **CLI Agent contract**：`ui4a doctor`、`apps list`、`entities get`、`actions exec --dry-run` 与 live
   `actions exec` 使用同一 Siren Action；结果同样进入 enriched。
3. **业务结果**：severity=high、affectedComponents=`ui4a-web/ui4a-worker`、source 明示
   `reference-catalog:security-v1`，页面常显“受控参考漏洞（非实时情报）”。
4. **事件链**：human/CLI source Action → spawn → capability terminal receipt → system callback Action；
   callback 的 executionId/result/receipt 均 `origin=effect`。
5. **Work Thread**：CLI 经公共 `threads/create` + `thread/attach` 显式挂载 CVE；未 attach 的纯测试证明
   scope/presence/execution 不自动扩张成员。

### UI、授权、审计与扩展证据

- Desktop 1512×982：CVE 详情显示业务状态、影响信息、参考来源；无 handler/profile/attempt/Temporal。
- Mobile 390×844/full：Work Thread 显示目标、进行中、显式 CVE 成员和责任动作，布局无横向破坏。
- D51 正负例：grants=`publishing` 拒绝 Security CVE；grants=`security` 允许。
- raw audit：`/api/events?domain=capability&kind=function-execution-finalized` 返回完整 handler/profile/hash/
  attempt/callback receipt，机制信息不进入普通实体。
- 第二 `document.normalize` fixture 只增加 Bundle、profile 和 handler registration；dispatcher、service、
  EntityView source audit 无业务名分支。

### 自动化门

- Focused Playwright：Application Directory 四宽度 + HTTP 同源 + Work Thread CLI，共 6 passed。
- Focused bundle/handler/presentation/auth/event tests 全绿。
- 首次 full check 的 17 个失败均为旧测试硬编码 10/8/6/22 封闭清单；改为
  `installedApplicationBundles` 派生后，相关 6 DB suites / 66 tests 通过。
- 最终 `UI4A_WORKER_HEALTH_PORT=3199 pnpm check`：488 files passed、3672 tests passed、6 skipped；
  typecheck、lint（仅既有 warnings）、strict governance 全绿。

自治验收结论：Phase D 达成；Security Application 证明新增领域只贡献合同、Adapter registration 与
参考数据，workstation、Assistant/CLI 合同、Work Thread 和授权机制无需业务特判。

## Phase E — S1–S14 最终验收矩阵

| Story | 可复跑证据 | 结果 |
| --- | --- | --- |
| S1 Human Action | `security-presentation.test.tsx` + Phase D live renderer/HTTP | PASS |
| S2 Agent same Action | dispatcher/contract tests + Phase D CLI live；真实 LLM 单列下一任务 | MECHANICAL PASS |
| S3 Application 不知道实现 | Security bundle/sitemap deployment-leak scan | PASS |
| S4 最小输入披露 | binder unit/property + sealed dispatch birth | PASS |
| S5 合法输出回流 | Worker adapter + finalize + DB receipt + live enriched entity | PASS |
| S6 非法输出不是事实 | adapter output schema/budget + finalize invalid hash/schema | PASS |
| S7 异常诚实失败 | retryable/permanent/timeout/cancel + on-error contracts | PASS |
| S8 重试不重复效果 | partial unique/advisory lock + real Temporal SIGKILL + duplicate callback | PASS |
| S9 Callback 仍受裁决 | stale-node finalize test records `action-rejected` | PASS |
| S10 缺配置 | activation/dispatcher missing/unavailable profile tests | PASS |
| S11 重放一致 | full DB replay suites + receipt/outbox tests | PASS |
| S12 不暴露机制 | EntityView/Work Thread tests + desktop/mobile screenshots + raw audit split | PASS |
| S13 第二 Capability | `document.normalize` fixture + source audits + handler registration | PASS |
| S14 授权隔离 | Security grant positive/negative + sealed handler input | PASS |

最终 focused story command：11 unit files / 72 tests、4 DB files / 16 tests、真实 Temporal 2 tests，全部
通过。Safety stories S4/S6/S8/S9/S10/S14 的已登记用例无 skip、无失败。
