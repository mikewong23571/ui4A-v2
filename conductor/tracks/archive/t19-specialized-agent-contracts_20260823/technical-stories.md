# T19 Technical Stories — Specialized Agent Contracts

## TS1 Shared contracts

定义 versioned AgentDefinition、PromptTemplate、RuntimeRequirement、Tool/Context/Artifact/Evaluation
Policy、AgentTaskEnvelope、AgentResultEnvelope、AgentRun refs 和 limits。

DoD：跨 runtime DTO 无 Node/DB/Provider；schemaVersion 明确；round-trip/property tests。

## TS2 Definition parser and canonicalization

解析 typed prompt blocks、bindings、schemas、policies 和 derivation refs，生成 canonical hash。

DoD：未知字段、过大/过深结构、坏 JSON Pointer/变量稳定拒绝；同义输入 hash 稳定。

## TS3 Derivation resolver

解析 `extends definition@version`，检测缺失、循环、禁止覆盖并 flatten immutable definition。

DoD：property tests；执行时不查 mutable parent pointer；birth version 可重放。

## TS4 Activation invariants

新增 prompt-bindings-valid、runtime-features-valid、tools-registered、resource-policy-valid、
verifiers-registered、eval-evidence-valid、derivation-acyclic 等检查。

DoD：全量报告不短路；checks 入 Draft/activation event；非法定义零 Active 变化。

## TS5 Generic Agent Run kernel

从 T18 Capability Run 提炼 provider-neutral Agent Run lifecycle、cursor、questions、grant requests、
artifacts/results、idempotency、CAS 和 restart boundary。

DoD：pure kernel 不出现 coding/writing/provider 名；T18 compatibility adapter 通过。

## TS6 Definition persistence and registry

Agent Definition/version/template/eval events 使用独立 domain 或明确 family，payload 内容寻址，
registry projection 可重建。

DoD：owner/scope isolation、version CAS、idempotency、payload integrity、replay hash。

## TS7 Meta Draft and activation

复用 T17 Draft ingress，增加 `agent-definition` kind、mechanical diff、human-only atomic activation。

DoD：Agent draft 可以提交，approve 100% 拒 Agent；human apply + accepted 同事务。

## TS8 Siren and sitemap

投影 `meta/agent-definitions`、exact definition/version/activation、业务 Agent registry 摘要和 Run links。

DoD：业务/meta 跨站规则；Provider secret 零披露；actions 全部 action-backed。

## TS9 Prompt compiler

把 flattened definition + typed task/context 编译为 Provider-neutral system/user message contract。

DoD：无字符串权限提升；task 数据被清晰定界；prompt hash 与实际发送内容一致。

## TS10 Runtime registry

Runtime Profile 注册 class/features/tools/resource backends/provider adapter，解析时不 fallback。

DoD：activation/start 双预检；请求 override 全拒；实际 profile/version provenance 入 Run。

## TS11 Tool and resource grant intersection

计算 Definition policy ∩ Capability/Application policy ∩ principal grants ∩ per-Run approval。

DoD：只能收紧；无 grant 工具不投影；approval scope/expiry/revocation 可重放。

## TS12 Generic Temporal workflow

实现 prepare → execute/resume → collect/verify → finalize，支持 needs-input/resource-approval signals。

DoD：真实 kill/cancel/restart；completed activity 幂等；source callback 不滞留 running。

## TS13 Result validation and proposal bridge

校验 output schema、artifact refs、verifier evidence 和 proposed effects，将结果交回声明 action/Draft。

DoD：Provider claim 不替代 verifier；Agent accept/activate 拒绝；stale/duplicate 归零。

## TS14 Coding specialization migration

以 AgentDefinition/Task/Result/Runtime/Verifier adapters 表达 T18 coding.execute。

DoD：T18 deterministic + real corpus 无回归；generic Host source governance 零 coding 分支。

## TS15 Writing specialization

实现 WritingBrief/WritingResult、document artifact workspace、source/citation/render verifier 和应用故事。

DoD：真实 writing corpus ≥80%，Safety 100%，零代码仓库/发布副作用。

## TS16 Agent-definition authoring specialization

让现有 Agent 从自然语言目标生成 Agent Definition Draft、examples 和 Eval corpus。

DoD：真实 5 variants ≥80%；生成物只进 Draft；定义作者无 approval capability。

## TS17 Evaluation harness

分离 mechanical Safety、schema/verifier、真实 Agent rubric；记录 definition/prompt/runtime/task/result
hash、trajectory、artifacts、latency 和 cost/usage。

DoD：不固定工具轨迹/措辞；失败可复现且不污染 Active registry。

## TS18 Renderer and human governance

Renderer 展示 specialization intent、Prompt/contract diff、runtime requirements、Eval evidence、Run
progress/questions/grants/results 和 human decisions。

DoD：移动端、action fuzz、raw 下钻；系统 Prompt secret/credential 不作为普通业务字段展示。

## TS19 Replay, concurrency and migration

覆盖 definition version、Run birth version、parallel Runs、parallel activation、projection rebuild 和
T18 event compatibility。

DoD：空投影重建 hash 一致；旧 Run 零漂移；CAS 无最后写赢。

## TS20 Governance and documentation

建立 source rules 防止业务名/provider 泄漏进 generic Host，同步 GOAL/DECISIONS/product/tech/arch/
runtime/audit/AGENTS/README/DONE。

DoD：Principal review 无 High；Hermes/marketplace/self-improvement 保持非目标。
