# T43 用户故事与验收合同

> 每个可操作故事由人类 renderer 与 Agent/CLI 合同路径各执行一次；二者使用同一 Siren Action、
> 同一裁决器和同一事件日志。真实 LLM 只证明自然语言到 Action 的动态选择，不替代机械安全证据。

## S1 — 人类从实体发起

Given 用户有权查看一个 identified CVE  
When 用户通过 renderer 执行“补充影响分析”  
Then 同一 Siren Action 通过裁决，实体进入 enriching，并产生一条 `spawn-requested`。

## S2 — Agent 从同一合同发起

Given Agent 拥有相同 Application grant 和当前 CVE 处境  
When 用户说“补充这个 CVE 的影响信息”  
Then 真实 LLM 选择同一个 Action，而不是直接调用 Native Function；人与 Agent 的执行进入同一事件链。

## S3 — Application 不知道实现

Given `cve.enrich` 绑定 Native Function Profile  
When 查看 Application Bundle、Sitemap 和普通实体合同  
Then 不出现 handler、文件路径、Temporal 配置或部署凭证。

## S4 — 最小输入披露

Given CVE 实体包含编号和其他字段  
When 构造函数输入  
Then 只传递声明 binding 引用的字段；工作线、其他应用事实和凭证均不进入函数输入。

## S5 — 合法输出回流

Given Native Function 返回符合 output schema 的影响信息和来源  
When finalize 执行  
Then 系统记录 receipt/output hash，并通过 `enrichment-succeeded` Action 写入带 `effect` 来源的业务事实。

## S6 — 非法输出不是事实

Given Native Function 返回缺字段、错误类型或超预算结果  
When 系统校验输出  
Then 结果进入结构化失败，执行 `on-error`；CVE 不进入 enriched，非法内容不写入业务字段。

## S7 — 函数异常诚实失败

Given Native Function 抛错、超时或被取消  
When Temporal 完成规定的重试  
Then 只产生一条终局失败回执，实体进入可恢复失败状态，Assistant 使用业务语言解释，不输出内部堆栈。

## S8 — 重试不重复产生效果

Given Worker 在函数完成后、callback 提交前崩溃  
When Temporal 重试 finalize  
Then 相同 execution identity 只产生一个有效 callback 结果，不重复追加分析实体或状态迁移。

## S9 — Callback 仍受裁决

Given source entity 已被其他动作推进，原 callback 不再适用  
When Function 成功结果返回  
Then callback 被 guard 拒绝并留痕；函数成功不覆盖更新后的业务状态。

## S10 — 缺少部署配置

Given Flow 引用未部署的 Native Function Profile  
When 提交激活或启动执行  
Then fail closed，零函数调用、零半成品业务写入，不选择其他 handler 或 Agent fallback。

## S11 — 重放一致

Given 成功、失败、拒绝和重试记录均已产生  
When 从空 projection 重放 PostgreSQL 事件日志  
Then CVE、Capability receipt、Work Thread 状态和 callback 结果与重放前一致。

## S12 — 工作台不暴露机制

Given 用户在桌面和窄屏查看 CVE 工作线  
When 能力正在执行、完成或失败  
Then 只看到工作状态、结果、来源和责任点；Native Function/Temporal 细节只在 raw/audit 中可查。

## S13 — 第二个 Capability 不产生特判

Given 新增另一个 Native Function Capability fixture  
When 激活并执行  
Then 只增加定义、Profile 和 handler registration；通用 dispatcher、workstation 和 Assistant 不新增
capability-name 或 Application-name 特判。

## S14 — 授权隔离

Given principal 未获 Security Application grant，或 source CVE 不在授权 audience  
When 人、Agent、CLI 或 callback 尝试读取/执行  
Then 按现有授权合同拒绝且不泄漏 CVE、函数输入、输出或 receipt。

## Evidence Matrix

| Story | Pure/Unit | DB/HTTP | Temporal | Human UI | Agent/CLI | Replay/Safety |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Action/effect | exec | dispatch | desktop/mobile | CLI parity | event chain |
| S2 | disclosure | chat route | dispatch | shared focus | real LLM | effect authorization |
| S3 | bundle scan | sitemap | — | Meta/raw split | CLI export | no deployment leak |
| S4 | binding property | preflight | sealed input | — | audit | no extra facts |
| S5 | result validation | callback | success | result state | contract read | receipt hash |
| S6 | schema/budget | callback | failure | recoverable state | rejection read | zero pollution |
| S7 | failure mapping | callback | retry/cancel | business language | honest failure | terminal receipt |
| S8 | idempotency | duplicate callback | crash/retry | one result | one receipt | replay |
| S9 | guard | stale callback | finalize | current state | rejection | no overwrite |
| S10 | invariant | activation/preflight | zero call | actionable check | denied | zero partial write |
| S11 | fold | projection rebuild | recovered result | same projection | same contract | hash equality |
| S12 | view model | raw receipt | progress | desktop/390px | concise context | no mechanism leak |
| S13 | generic registry | second fixture | same workflow | unchanged shell | same discovery | no name branch |
| S14 | authorization | 403/hidden | sealed input | no disclosure | denied | no cross-grant data |
