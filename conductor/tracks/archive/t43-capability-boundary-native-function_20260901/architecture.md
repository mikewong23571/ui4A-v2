# T43 技术架构 — Capability Port、Native Function Adapter 与受治理结果回流

> 绑定决定：`DECISIONS.md` D59；产品合同：本 Track `spec.md` 与 `user-stories.md`。
> 本文固定 disposable probe 后的实现边界。实施若偏离，须先修订本文与 D59。

## 一、结论

Capability 是 Application 声明的外部执行 Port；Native Function 是部署侧 Adapter。Function
执行不创建 Run、资源或第二套状态机：已持久化的 `spawn-requested` 是不可变出生记录与 outbox，
Temporal history 只负责耐久编排，`function-execution-finalized` 是终局审计回执，callback Action
产生的 Application 事件才是业务事实。

```text
Application Bundle                 Deployment                         Business truth
──────────────────                 ──────────                         ──────────────
Capability + spawn                 Native Function Profile           PostgreSQL core events
  │ declaration/guard/schema         │ handler registry                ▲
  │ pure bounded binding              │ Temporal Workflow               │ callback Action
  ▼                                  ▼                                 │ re-judgment
spawn-requested ── deterministic ──► Activity ── typed claim ──► protected finalize
  (birth + outbox)   workflow id      (I/O boundary)             receipt + callback atomic
```

依赖方向保持：

```text
packages/shared  ←  packages/engine  ←  packages/agent
       ▲                    ▲
       └──────── packages/db┘
       ▲                    ▲
 apps/web composes       apps/worker composes
```

`shared` 只放平台中立 wire；`engine` 只做纯绑定、schema 与裁决；`db` 只做 PostgreSQL
事务/唯一性；Web 做业务命令组合；Worker Workflow 只编排，Activity 才解析部署 profile、调用
handler 与做 I/O。Web 与 Worker 不互相 import。

## 二、定义面与部署面的边界

### 2.1 Application 可声明的内容

`CapabilityDefinition` 只声明稳定 name/title/intent/kind、input/output JSON Schema、scope 与
executor requirement：

```ts
executor: {
  class: 'native-function';
  profile: 'security-enrichment-default';
}
```

Function executor 不要求、也不得伪造 `agentDefinition`。Agent executor 继续要求 exact
Agent Definition，既有 birth-pinned canonical Agent Run 语义不变。

Flow 的 spawn 只声明 capability、输入绑定与 `on-done`/`on-error`。Bundle 不得出现 handler、
module path、endpoint、credential、Temporal queue/timeout/retry 或部署 availability。

### 2.2 部署侧 Profile

部署配置经严格 parser 形成只读 registry：

```ts
interface NativeFunctionProfileV1 {
  schemaVersion: 1;
  ref: string;
  version: string;
  executorClass: 'native-function';
  handlerRef: string;
  adapterVersion: string;
  availability:
    | { status: 'available' }
    | { status: 'unavailable'; reason: string };
  limits: {
    startToCloseTimeoutMs: number;
    maximumAttempts: number;
    inputBytes: number;
    outputBytes: number;
  };
  network: 'denied';
}
```

首个本地 Adapter 的 network 固定 denied。timeout、attempt 与 payload budget 是可执行硬门；
同进程函数无法诚实提供进程级 CPU/内存隔离，因此本 Track 不声称硬 memory/CPU sandbox。
Handler 必须异步、响应 `AbortSignal`、不做无界同步计算。首个切片只允许纯或按 executionId
幂等的 transform/extract handler；带外部副作用的 `effect` handler 在另立幂等协议前 fail closed。

Profile 由服务端选择。请求、Assistant、CLI、Action params 和 Application 定义均不能覆盖它。

## 三、声明式输入绑定

### 3.1 V1 wire

`spawn.bind` 规范化为一个封闭、无表达式语言的白名单映射：

```ts
interface CapabilityInputBindingV1 {
  schemaVersion: 1;
  fields: Record<
    string,
    | { from: 'action-param'; name: string }
    | { from: 'source-field'; name: string }
    | { from: 'artifact-ref'; param: string }
  >;
}
```

- destination 只允许 top-level JSON property；不得出现 JSONPath、wildcard、spread、脚本、模板或
  computed key；
- 每个 destination 恰有一个来源，重复 destination、未知来源与未知字段 fail closed；
- 最多 64 个 field binding；最终深度、节点数与 UTF-8 bytes 由共享 JSON budget 检查；
- `action-param` 只读已经通过 Action schema 的 params；
- `source-field` 只读当前 source entity 的显式 field；
- `artifact-ref` 的 ref 必须来自本次已校验 Action param，并经既有授权读取后再解引用；
- binder 的依赖只接收上述三个窄表，不接收 EngineSnapshot、Work Thread、Sitemap、identity、
  credential 或任意 context bag。

纯 binder 返回：

```ts
interface BoundCapabilityInputV1 {
  payload: JsonObject;
  sources: Record<string, CapabilityInputSourceRef>;
  hash: `sha256:${string}`;
  byteLength: number;
}
```

绑定后必须再次通过 Capability `inputSchema`。来源表只用于审计，不传给业务 handler。

### 3.2 旧 artifact bind

当前 `source-field`/`output-param` 是同步 artifact materialization 的历史专用形状，不是 Function
执行绑定。T43 采用单一 V1 wire，不增加双格式兼容路径；受影响 fixture 与 Bundle 原子迁移。

## 四、出生固定与执行 wire

### 4.1 `spawn-requested` 是出生记录与 outbox

Web 在追加任何业务事件前完成：Capability/Profile/handler availability、class、callback、binding、
input schema 与 payload budget 全部静态 preflight。失败时零 `action-executed`、零 spawn、零
Temporal 调用。

通过后，Web 将 server-resolved prepared invocation 写入同批 `spawn-requested.detail`。它包含可
重建执行所需的 bounded input 与不可变 birth refs，但不含 credential。Capability schema 由
`capability-seeded` 历史按 hash 解析；Profile 的非秘密身份信息固定在 spawn detail，后续部署改动
不得改变在途执行。

### 4.2 Invocation

source seq 分配后形成 sealed invocation：

```ts
interface NativeFunctionInvocationV1 {
  schemaVersion: 1;
  source: {
    eventId: `core:${number}`;
    rel: string;
    action: string;
    principal: string;
    policyScope: string;
  };
  birth: {
    capability: { name: string; hash: string };
    profile: {
      ref: string;
      version: string;
      handlerRef: string;
      adapterVersion: string;
      limits: {
        startToCloseTimeoutMs: number;
        maximumAttempts: number;
        inputBytes: number;
        outputBytes: number;
      };
      network: 'denied';
    };
    inputContract: { hash: string; schema: JsonObject };
    outputContract: { hash: string; schema: JsonObject };
  };
  callback: { onDoneAction: string; onErrorAction: string };
  input: BoundCapabilityInputV1;
}
```

Handler 只收到 `input.payload` 与 `{ executionId, signal }`；source、principal、callback 与 Profile
选择不会进入 handler 参数。

### 4.3 确定性 identity

```text
executionId = nf-<sourceSeq base36>-<short sha256(capability/profile/input birth)>
workflowId  = function-<executionId>
finalizeKey = function-finalize:<executionId>
```

同一个 source spawn 永远产生相同 identity；另一个 spawn 即使 payload 相同也产生新 identity。
Temporal already-started 只在 identity 与 invocation hash 完全一致时视为幂等成功，碰撞必须报错。

## 五、Temporal 与 Native Function Adapter

### 5.1 Workflow

`nativeFunctionWorkflow(invocation)` 只做确定性编排：

1. 使用 birth-pinned timeout/maximumAttempts 安排 execute Activity；
2. 接受 Activity 的 success/permanent-failure claim；retryable exception 交 Temporal bounded retry；
3. cancellation 时进入 non-cancellable finalize Activity，记录 cancelled 回执后仍保持 Workflow
   CANCELLED；
4. 任一终态调用 finalize Activity；Workflow 不访问 DB、HTTP、Node API、环境变量、handler registry
   或 wall clock。

Profile 的 retry/timeout 值进入 Workflow history，必须为严格 parser 产生的有界整数；不得在 retry
时重新读部署配置。

### 5.2 Execute Activity

Activity 负责：

1. 校验 invocation hash、input bytes 与 input schema；
2. 按 birth-pinned handlerRef 在 server-owned registry 精确解析一个 handler；
3. 只把 payload、executionId 与 Temporal cancellation signal 交给 handler；
4. 计算 canonical output hash/bytes，并通过 output schema；
5. 返回 typed outcome，或把 transient exception 抛给 Temporal retry。

Input/output contract、unknown handler、超预算与非法 output 是 non-retryable structured failure。
Handler 自报成功不等于成功；Worker 验证一次，Web finalize 再以出生合同验证一次。

### 5.3 Result

```ts
type NativeFunctionOutcomeV1 =
  | {
      schemaVersion: 1;
      status: 'succeeded';
      output: JsonObject;
      outputHash: `sha256:${string}`;
      outputByteLength: number;
      evidenceRefs: EvidenceRef[];
      attempt: number;
    }
  | {
      schemaVersion: 1;
      status: 'failed';
      failure: { code: string; reason: string; retryable: boolean };
      attempt: number;
    }
  | {
      schemaVersion: 1;
      status: 'cancelled';
      reason: string;
      attempt: number;
    };
```

输出上限足够小，可直接进入 capability-domain receipt；不新建 payload store 或 Run 表。

## 六、spawn outbox 的耐久派发

DB commit 与 `workflow.start` 之间没有分布式事务。仅在 append 后立即 start 会留下“DB 已提交、
Web 崩溃、Workflow 未启动”的孤儿。因此：

- request path 在 spawn commit 后立即尽力启动确定性 Workflow；
- boot 与有界周期 reconciler 扫描 Function `spawn-requested`，排除已有 terminal receipt 的
  executionId，并再次 start 相同 workflowId；
- already-started/completed 通过 invocation hash 对齐后视为成功；
- reconciler 只做 outbox delivery，不产生业务状态、Run 或第二 projection。

静态缺配置必须在 append 前失败；Temporal 暂时不可用属于未送达 outbox，不得伪造业务失败。
Application 的 enriching 状态来自已执行 source Action，恢复后仍可继续派发。

## 七、受治理 finalize 与 callback

### 7.1 受保护 ingress

Worker 复用既有 `UI4A_CAPABILITY_CALLBACK_TOKEN` 信任机制，但使用独立 Function callback route 与
body schema；Agent callback wire 不扩展为联合类型。Ingress 只接收 executionId/source event ref、
invocation hash 与 bounded outcome，不能选择 callback Action、principal、Profile 或 Capability。

### 7.2 重新裁决

Finalize 进入 Web engine 串行队列并刷新最新 core log，然后：

1. 读取 exact source seq，验证它确为匹配 rel/action/capability 的 `spawn-requested`；
2. 验证 Capability/Profile/input/output contract 的 birth hashes 与 invocation hash；
3. 再次校验 output schema、hash 与 byte budget；非法 success 转为声明的 failure callback；
4. 读取当前 source entity，选择 birth 中的 `on-done` 或 `on-error`；
5. 以 `actor=agent`、`principal=system:capability:<executionId>`、
   `channel=native-function-callback` 执行 declaration → guard → schema；
6. 所有 callback `paramOrigins` 固定为 `effect`；不得把 system principal 冒充 human，不得绕过
   confirmation 或 human-only decision。

Success params 固定为：

```ts
{ executionId, result: output, receipt: { outputHash, evidenceRefs } }
```

Failure params 固定为：

```ts
{ executionId, failure: { code, reason } }
```

Callback Action 可将 `result` 作为一个 `persist:false` JSON param，再由声明效果写入一个结构化
业务 field；不增加 nested-path effect 或按 output key 的 dispatcher 分支。

### 7.3 混合域原子提交

Callback judgment 产生的 core events 与一条 capability-domain terminal receipt 必须在同一个真实
PostgreSQL client/transaction 提交。不得先写 receipt 再另调 `/api/exec`，也不得先改业务再补
receipt。

```ts
interface NativeFunctionReceiptV1 {
  schemaVersion: 1;
  executionId: string;
  sourceEventId: `core:${number}`;
  invocationHash: `sha256:${string}`;
  capability: { name: string; hash: string };
  profile: {
    ref: string;
    version: string;
    handlerRef: string;
    adapterVersion: string;
    limitsHash: `sha256:${string}`;
  };
  inputHash: `sha256:${string}`;
  outcome: NativeFunctionOutcomeV1;
  callback: {
    commandId: `function-finalize:${string}`;
    action: string;
    outcome: 'accepted' | 'rejected' | 'suspended';
    reason?: string;
  };
}
```

事件 kind 固定 `function-execution-finalized`、domain 固定 `capability`。数据库建立 partial unique
index：

```sql
CREATE UNIQUE INDEX function_execution_terminal_unique
ON events ((detail->>'executionId'))
WHERE domain='capability' AND kind='function-execution-finalized';
```

Finalize transaction 对 executionId 取 advisory lock。已存在 receipt 时必须比较 invocationHash 与
outcome canonical hash：完全相同返回原 callback outcome；不同即 idempotency collision，禁止覆盖。
Worker 在“receipt/callback 已提交但 Activity 回包前崩溃”后重试，只会命中这条幂等路径。

现有 `appendBatchWithSeq` 假设 batch 全是 core event，不能直接用于混合域；实现须增加 mixed-domain
append helper，或安全泛化计数逻辑，使 `committedCoreCount` 只统计 core rows、Business fold 只消费
core rows。不要复制 notify 的 check-then-insert 去重；唯一约束才是并发裁判。

同一 Web service 内 callback 与用户动作由现有 engine queue 串行，晚到 callback 必须重新过当前
guard，不能覆盖已变化的状态。多 Web replica 的全局 command serialization 属既有 non-HA 边界，
不在 T43 扩成分布式业务锁。

## 八、投影、Work Thread 与无 Run 约束

- 不新增 Function/Capability Run table、aggregate、projection、Siren entity、collection 或页面；
- `spawn-requested` 不改变 fold；source Action 已把实体推进到 enriching；callback Action 再推进为
  enriched/enrichment-failed；
- Work Thread 只引用 source CVE entity，显式 attach 语义不变；
- 普通 Workstation 只消费业务状态、结构化结果/来源与下一责任点；
- Function receipt、handler/profile/attempt/raw outcome 只在 raw/audit 可读；
- Temporal current state 不进入 Business fold，也不作为 UI 状态真相；
- `packages/db/src/events.ts` 中未使用的 `capability-run-*` enum 与
  `packages/engine/src/capability-run/` 名称不能被 T43 复活为执行模型；Agent 仍唯一使用 canonical
  Agent Run。

## 九、模块落位

| 责任 | 预期模块 |
| --- | --- |
| Profile/invocation/outcome/receipt wire | `packages/shared/src/deployment/native-function.ts` |
| 纯 binding、budget、schema result | `packages/engine/src/execution/capability-input-binding.ts`、邻近纯模块 |
| receipt 事务、唯一索引与查询 | `packages/db/src/function-receipts.ts` |
| executor class dispatch 与 prepared spawn | `apps/web/src/engine/capability/function-dispatch.ts` |
| mixed-domain finalize/re-judgment | `apps/web/src/engine/capability/function-finalize.ts` |
| protected ingress | `apps/web/src/app/api/internal/function-callback/route.ts` |
| Temporal start/cancel/reconcile adapter | `apps/web/src/temporal/function-execution.ts` |
| deterministic Workflow export | `apps/worker/src/workflows.ts` 的薄出口 + 邻近纯编排模块 |
| handler registry/Activity/adapter | `apps/worker/src/capabilities/function/` |
| reference handler | `apps/worker/src/capabilities/function/handlers/` |
| Security Application data | `apps/web/src/applications/` Bundle/fixture |

通用 dispatcher 只按 `executor.class` 选择 Agent 或 Function composition；不得读取 capability name、
Application name、CVE 词汇或 handler 名来决定路径。

## 十、计划精确修订

正式实现前应把以下内容补入原 Phase，不扩大产品范围：

1. **Phase B / deployment contract**：增加 `network='denied'`、cooperative cancellation 与“不声称
   hard CPU/memory isolation”的合同测试；增加 binding 最大字段数、深度/节点/bytes、禁止
   wildcard/spread/expression 的测试。
2. **Phase C / dispatcher**：增加“prepared invocation 写入 spawn birth detail”与“DB commit 后、
   workflow.start 前 crash”的 Red 测试。
3. **Phase C / Worker Adapter**：增加 retryable exception 与 permanent schema/budget failure 分类，
   以及动态 birth-pinned timeout/retry 的 Workflow determinism 测试。
4. **Phase C / finalize**：增加 mixed-domain single-transaction、partial unique index、同 key 不同 hash
   collision、Activity commit 后回包前 crash 的测试；禁止使用 check-then-insert 去重。
5. **Phase C / verification**：增加 outbox reconciler 真实恢复场景，证明 orphan spawn 最终启动且
   同 workflowId 不重复业务效果。
6. **Phase D / reference handler**：明确首个 handler 为 network-denied、纯 transform/extract；第二
   fixture 同样只靠 registration 扩展。

## 十一、技术栈与 probe 证据

零新增 runtime dependency、workspace、数据库产品或基础设施；复用现有 TypeScript、JSON
Schema/Ajv、PostgreSQL append-only events、Temporal TypeScript SDK、Next.js route 与 callback token。
因此 `conductor/tech-stack.md` 无需修改。

Phase A probe 在本机既有 Temporal dev server 上运行：

```text
pnpm vitest run --project unit \
  packages/engine/src/execution/effects.test.ts \
  apps/web/src/temporal/agent-run.test.ts \
  apps/worker/src/agents/host/finalize.test.ts \
  apps/worker/src/agents/host/temporal.integration.test.ts

4 files passed, 32 tests passed
```

真实用例覆盖 Worker SIGKILL 后 Activity retry/resume、cancellation 与 non-cancellable terminal
finalize，证明本架构无需新 Temporal/测试依赖。它只证明平台机制与现有 seam；T43 Function
合同、outbox 与 mixed-domain finalize 仍须按计划 Red → Green 实现。
