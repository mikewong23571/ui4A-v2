# T43 Phase A：当前行为 Red 基线

记录日期：2026-09-01。观察基线：`82781fd2`。本文件只记录当前实现证据；没有实现
Function Adapter，也没有把 disposable probe 留在测试树中。

## 结论

当前纯合同允许 Capability 声明 `executor.class/profile` 且不携带 `agentDefinition`，激活检查也能按
profile 名与 class 做通用匹配；但 Web 的唯一 executable Capability 派发路径在写入业务事件前硬性
要求 `agentDefinition`，随后只会准备并创建 canonical Agent Run。因此一个配置为
`{ class: "function", profile: "local-function" }` 的 Capability 会在服务组合层稳定失败：

```text
capability coding.execute executor has no Agent Definition;
only canonical Agent Runs can be dispatched
```

这项 Red 是缺少 Function dispatcher/profile/Activity Adapter，而不是数据库、Vitest、种子定义或现有
Agent dispatch 环境故障。两组既有 focused tests 共 65 项通过；同一 DB test harness 下的未来合同
probe 准确到达 `apps/web/src/engine/service.ts:480-483` 并以预期缺口失败。

## Disposable Red probe

临时 probe 位于
`apps/web/src/engine/service-tests/t43-function-dispatch-red.probe.test.ts`，完成观察后已删除。它复用
真实 `getEngine(pool)`、独立测试数据库和内置 `software-change` Action，把已加载 Capability 的 executor
替换为 `{ class: "function", profile: "local-function" }`，然后断言未来合同应返回
`{ kind: "accepted" }`。

命令：

```bash
pnpm vitest run --project db \
  apps/web/src/engine/service-tests/t43-function-dispatch-red.probe.test.ts
```

结果：exit 1；1 file / 1 test failed。失败不是连接、迁移、schema 或 fixture 错误，而是：

```text
AssertionError: promise rejected ... instead of resolving
Caused by: Error: capability coding.execute executor has no Agent Definition;
only canonical Agent Runs can be dispatched
  at apps/web/src/engine/service.ts:481:19
```

正确的未来 Green 不是放宽 `prepareNativeAgentDispatch`：服务应先按 executor class 选择部署侧
dispatcher；`agent` 继续进入 Agent Run，`function` 进入 Function Adapter。正式测试应使用独立 fixture
Capability，且不得按 `coding.execute` 或任何 Application 名分支。

## 当前合同与代码指针

### Capability 与 executor profile

- `packages/shared/src/definition/definition.ts:285-314`：Capability 可以声明 input/output schema、scope
  和 server-resolved `executor.class/profile`；`agentDefinition` 在类型上可选。Bundle 合同没有 handler、
  endpoint、credential 或 Temporal 配置。
- `packages/engine/src/definition/invariants.ts:189-207`：`executor-profile-valid` 只检查被引用 Capability 的
  profile 是否存在及 class 是否相等；它不要求 `agentDefinition`，也没有 Function handler 可用性注册表。
- `apps/web/src/engine/agent/coding-executor-config.ts:9-31`：当前激活 profile registry 仅从
  `UI4A_CODING_EXECUTOR_PROFILES` 解析 Coding Agent profile；缺环境变量时 registry 为空，运行时精确
  profile 缺失会诚实失败。
- `apps/web/src/engine/service.ts:285-289`：Meta activation 只装配上述 Coding Agent profile registry。
  目前没有 Native Function profile/handler registry。

### Spawn 与 binding

- `packages/shared/src/definition/definition.ts:144-150`：`spawn.bind` 当前只是
  `Record<string, unknown>`，可携带 `on-done/on-error`，尚无受限的 source/action/artifact binding wire。
- `packages/engine/src/execution/effects.ts:358-370`：纯 engine 只把 capability、原始 bind 和 callbacks 复制
  到 `spawn-requested`；不解析 bind、不构造 executor input，也不改变实例状态。
- `packages/engine/src/execution/effects.test.ts:365-450`：既有测试固定事件顺序以及 `persist:false` Action
  参数不写入源实例的语义；它没有证明 Function input 的字段白名单或 inputSchema 二次校验。
- `apps/web/src/engine/service.ts:309-330`：日志 append shape 原样持久化 capability/bind/callback 声明，
  没有在此处扩张成 EngineSnapshot、Work Thread、Sitemap 或凭证。

因此，当前 bind 是可审计的声明载荷但不是已经实现的 Function input binder。T43 Green 必须新增纯、
有界、字段级来源可追踪的 binder，并在派发前再次校验 Capability inputSchema。

### 当前唯一 executable dispatch

- `apps/web/src/engine/service.ts:466-495`：服务在 append 前扫描 `spawn-requested`；有 executor 但无
  `agentDefinition` 时直接抛错，否则只调用 `prepareNativeAgentDispatch`。
- `apps/web/src/engine/service.ts:501-530`：只有所有 preflight 通过后才 append；随后唯一持久化/派发模型是
  `createAndDispatchAgentRun`。
- `apps/web/src/engine/agent/native-agent-dispatch.ts:247-266`：Agent mapper 明确以 exact Agent Definition
  为出生合同，并再次拒绝无 `agentDefinition` 的 Capability。
- `apps/web/src/engine/agent/native-agent-dispatch.ts:267-317`：后续解析 active exact definition、
  specialization mapper 和 server-owned runtime profile，并核对 executor class；该代码应保持 Agent-only。

这也固定了 fail-before-mutation 顺序：Function 缺口发生在 `appendBatchWithSeq` 之前，没有半成品
`action-executed`/`spawn-requested`，且不会调用 Agent Temporal dispatcher。

### Callback

- `apps/web/src/engine/service.ts:521-560`：Agent Run 创建/派发若同步终止为 failed，只能选择出生记录中的
  `onErrorAction`，以 `system:capability:<runId>` 和 capability callback channel 重新调用
  `executeWithGates`；拒绝或挂起不会被绕过。
- `apps/web/src/engine/agent/agent-run-source-callback.ts:12-65`：异步终态 callback 重新读取 Agent Run 和
  source entity，按 succeeded/terminal failure 选择出生固定的 on-done/on-error，并通过 `engine.exec`
  重新裁决；当前 dedup 依据 source fields 中相同 `runId`。

现有 callback 是 Agent Run-specific；Function 不能伪装成 Agent Run。T43 需要独立、受保护的 Function
finalize ingress，验证 source spawn/capability/profile birth、output schema 与 receipt，再执行声明的
callback Action，但不新增第二个权威 Run 模型。

### Artifact

- `apps/web/src/engine/service-artifacts.ts:29-87`：当前同步 materialization 只识别 bind 中的
  `source-field` + `output-param`，从当前 source field 与已校验 Action params 取值，以 `LLM_MODEL` 和内容
  hash 生成 `capability-artifact-created`。它不是外部 Function output，也不执行 outputSchema 校验。
- `apps/web/src/engine/service-artifacts.ts:90-113` 与 `apps/web/src/engine/service.ts:466`：只有确实满足上述
  materialization 形状时才要求 LLM model，而且在业务 append 前 preflight，避免半成品事件。
- 仓库当前没有直接引用 `materializeSpawnArtifacts` 或 `artifactModelFor` 的 dedicated `*.test.ts`；
  `effects.test.ts:407-450` 只固定 `persist:false` 参数与 spawn 事件边界。因此本任务没有虚构一个
  “service-artifacts focused suite”；后续正式改动需在最窄边界补测试。

T43 应保留 artifact 为可重放事实载体，但 Function handler 的返回值在 schema 校验和 callback 裁决前
只能是外部 claim，不能直接走现有同步 Action-param materialization 变成业务事实。

## Focused baseline commands

```bash
pnpm vitest run --project unit \
  packages/engine/src/execution/effects.test.ts \
  packages/engine/src/definition/invariants.test.ts
```

结果：exit 0；2 files passed，55 tests passed。

```bash
pnpm vitest run --project db \
  apps/web/src/engine/agent/native-agent-dispatch.test.ts
```

结果：exit 0；1 file passed，10 tests passed。该 suite 同时证明现有 Agent path 能成功 dispatch，以及缺
exact profile/Agent Definition 时会在 source transition 前失败且日志不变。

```bash
if rg -l 'materializeSpawnArtifacts|artifactModelFor' apps/web/src -g '*.test.ts'; then
  exit 2
else
  echo 'NO_DEDICATED_SERVICE_ARTIFACTS_TEST'
fi
```

结果：exit 0；输出 `NO_DEDICATED_SERVICE_ARTIFACTS_TEST`。

## Phase B/C 可执行 Red 边界

后续正式 Red 应分别落在以下边界，而不是保留本次 disposable probe：

1. shared deployment contract：严格 Function profile、handler ref、timeout/retry/payload budget 与 result
   envelope；
2. pure engine：声明式 input binding、来源白名单、input/output schema 和 activation invariants；
3. web composition：按 executor class 通用派发，静态 preflight 失败零事件/零 Activity；
4. worker：handler registry + Temporal Activity，确定性 execution identity、bounded retry/cancel；
5. finalize ingress：receipt/hash、重复投递、stale guard 和声明式 callback Action。

这些边界保持 PostgreSQL 单日志为业务真相，不引入 Capability Run，不泄漏部署配置，也不增加
capability-name/Application-name 分支。

## Native Function durable execution probe

独立 probe 对照当前 notify 单 Activity、Agent Host 恢复/finalize、事件批量追加与 callback 路径，结论
是首切片不需要新建 Function/Capability Run：

```text
spawn-requested
  = durable request + immutable birth record + transactional outbox

Temporal workflow history
  = retry / crash recovery / cancellation coordination

native-function-finalized
  = terminal receipt + callback audit

callback Action events
  = only business truth
```

`sourceSeq` 是 execution identity 的稳定根；workflow ID 从 source seq 与 birth hash 确定性派生。Handler
只接收有界 payload、execution ID 与 cooperative AbortSignal，不接收 EngineSnapshot、DB/Web handle、
principal grants、Sitemap、callback action 或 profile-selection controls。

### Invocation、outcome 与 receipt

正式 wire 应包含：

- source event ID/rel/action/principal/policy scope；
- birth-pinned capability/profile/handler/adapter 与 input/output contract hashes；
- 声明的 success/error callback actions；
- bound payload、逐字段 source refs、input hash 与 byte length；
- succeeded/failed/cancelled outcome、attempt、output hash/length、evidence refs 或结构化 failure；
- terminal receipt 的 execution ID、invocation hash 与 callback accepted/rejected/suspended outcome。

成功 callback 用一个结构化 `result` 参数承载 output，并附带 `executionId` 与 receipt 摘要；失败 callback
使用结构化 failure。全部 callback 参数 origin 固定为 `effect`，避免输出键碰撞或新增 nested-path effect
语义。

### Finalize 原子性

Finalize 必须在 Web serialized command boundary 内重新读取 exact `spawn-requested`，验证 immutable
birth/input/outcome hashes，重新校验 output schema 与 byte budget，再通过 `executeWithGates` 裁决 callback。
同一 PostgreSQL 事务原子追加 capability-domain terminal receipt 与 callback core events；重复 execution
ID 的相同 outcome 返回既有回执，hash 冲突则拒绝。

现有 `appendBatchWithSeq` 把整批都计为 core event，不能直接用于 capability/core mixed-domain 批次；
正式实现需要 mixed-domain append helper 或安全泛化，只 fold/count core rows。Terminal receipt 还需要 DB
唯一约束，不能采用 notify 的 check-then-insert 作为并发幂等依据。

### Dispatch outbox gap

DB 提交 `spawn-requested` 后、Temporal `workflow.start` 前崩溃会遗留 orphan。仅有确定性 workflow ID 不足
以闭环；正式实现必须把 spawn event 作为 outbox，在 boot 与周期 reconciliation 中扫描未终结 Function
spawn，并幂等启动相同 workflow ID，不新增 outbox 表。

### First-adapter honesty

Native in-process handler 不能宣称 hard CPU/memory sandbox，也无法强制取消同步 CPU-bound 代码。首切片只
承诺有界 payload、Temporal deadline/retry、cooperative cancellation 和无阻塞 handler，并仅支持
pure/idempotent transform/extract。外部 `effect` 需要独立幂等合同，留给后续 Track。

Probe 命令：

```bash
pnpm vitest run --project unit \
  packages/engine/src/execution/effects.test.ts \
  apps/web/src/temporal/agent-run.test.ts \
  apps/worker/src/agents/host/finalize.test.ts \
  apps/worker/src/agents/host/temporal.integration.test.ts
```

独立执行结果：4 files / 32 tests passed，包含真实 Temporal Worker SIGKILL 恢复、Activity retry/resume、
cancellation 与 non-cancellable terminal finalize；无持久 probe 代码或新依赖。
