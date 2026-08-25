# T15 AI-first 动态助手 — Plan

> 依据 `spec.md`、`user-stories.md` 与 `conductor/workflow.md`。方法:Story-first Eval/TDD；每个 U1–U23 故事先建立失败 baseline，再实现通用机制。确定性测试只守合同与 safety，真实 LLM Eval 验收动态能力。状态:`[ ]` / `[~]` / `[x]`(完成时附 SHA)。

## Phase A: DeepSeek baseline 配置、Eval 合同与 disposable spike [checkpoint: 2bcd6dc]

- [x] Task: U23 配置 baseline——清点 GLM 专用 env/常量/文档与 Web/Worker 环境分叉；写 failing tests 证明源码默认 provider、供应商 key 名、缺项静默回退和 inline/delegated 配置漂移 — 42ed23e
- [x] Task: U23 provider-first implementation——provider-neutral `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` 解析与配置错误类型；删除硬编码 endpoint/model 和 GLM 专用 runtime key；统一 dev 启动向 Web/Worker 传递 gitignored 环境 — 42ed23e
- [x] Task: U23 DeepSeek profile verification——外部环境配置 `https://cpa.styleofwong.cn/v1` + `deepseek-v4-flash` 后，inline/render/delegated/probe 解析为同一 profile；`.env.example` 仅占位，源码/日志/报告 secret scan 通过 — 42ed23e
- [x] Task: disposable provider probe——实测 DeepSeek baseline 的 Chat Completions、流式帧、tool calling、结构化输出、错误体、模型标识与时延；结论进入 DECISIONS/git note，不为端点行为写永久特判 — 42ed23e
- [x] Task: 建立 story-eval 最小 harness 与版本化报告格式；必须记录真实 driver/model、场景输入、结构化 outcome、业务事件前后差分和人工 rubric，拒绝 exact wording/trace assertions — 7e979f4
- [x] Task: disposable story spike——只用 DeepSeek baseline 跑 U1/U5/U10/U12，验证多轮 messages/结构化输出/工具选择的 AI SDK 行为并记录失败证据；spike 不直接成为生产实现 — 7e979f4
- [x] Task: 记录 T15 superseding 决定(生产 Assistant AI-first、退出 rule fallback、对话上下文来自日志、临时认知/正式 artifact/action 边界、DeepSeek 真实 LLM Eval)，同步待实施的 GOAL/I1 变更说明 — cd70db7
- [x] Task: 根据 spike 结果细化后续实现触点和 Eval corpus，不改变 U1–U23 的产品验收语义 — 7e979f4
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — 2bcd6dc

## Phase B: AI-first runtime 与故障安全(U22) [checkpoint: a72d9fa]

- [x] Task: U22 failing acceptance——默认/auto、inline、delegated 在 LLM 缺失或失败时均无 rule fallback、零业务 mutation、错误可恢复；renderer 人工路径继续可用 — a72d9fa
- [x] Task: U22 implementation——rule driver 退出产品 runtime 与 UI 选择面；保留 scoped scripted/mock protocol fixtures，清理 rule 作为 Assistant 成功证据的测试 — a72d9fa
- [x] Task: U22 real-runtime verification——真实 LLM 路径记录 driver/model；故障注入只验证诚实失败与安全，不模拟智能成功 — a72d9fa
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — a72d9fa

## Phase C: 授权观察与临时回答(U1–U4) [checkpoint: 5384e03]

- [x] Task: U1 Eval/TDD——“总结第一篇文章”及变体先红；实现完整授权 properties 观察、来源引用和临时 answer，摘要忠于 `post:first-post` 且零 mutation — d306b18
- [x] Task: U2 Eval/TDD——事实问答直接使用合同属性，不要求 read/count action，不把 `done` 绑定到成功写动作 — d306b18
- [x] Task: U3 Eval/TDD——跨实体读取、来源隔离、比较/归纳；输出可变但事实覆盖和引用可核对 — d306b18
- [x] Task: U4 Eval/TDD——缺正文时诚实说明信息缺口，不按标题编造、不误执行状态 action — d306b18 / 5384e03
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — 5384e03

## Phase D: Event-sourced 多轮目标形成(U5–U9) [checkpoint: be46e9f]

- [x] Task: 会话上下文红测——原始 user/assistant 内容 append-only 留痕，结构化 activeGoal/referents/constraints/pending clarification/authorized effects 可从日志重建 — be46e9f
- [x] Task: U5 Eval/TDD——省略对象的后续“总结一下”延续上一轮 focus/指代 — be46e9f
- [x] Task: U6 Eval/TDD——用户纠正替换当前指代，旧对象零副作用，原始消息不可改写 — be46e9f
- [x] Task: U7 Eval/TDD——补充“自己总结、不保存”合并进原目标而非成为独立任务 — be46e9f
- [x] Task: U8 Eval/TDD——歧义请求进入自然澄清/只定位，不从可用 action 猜业务意图 — be46e9f
- [x] Task: U9 Eval/TDD——刷新、重连和同 session 恢复后“继续刚才那个”重建同一活动目标和约束 — be46e9f
- [x] Task: 上下文有界化——近期原文 + 结构化状态的裁剪/压缩策略保留授权证据与指代，并有长会话回归 — be46e9f
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — be46e9f

## Phase E: 意图与副作用边界(U10–U13) [checkpoint: 55778a8]

- [x] Task: U10 Safety TDD——信息/解释/总结/比较请求在多种表达下 100% 零业务 mutation；安全断言不依赖 LLM judge — 55778a8
- [x] Task: U11 Eval/TDD——明确“下线第一篇”由 LLM 映射到声明 action，经现有三层裁决且只影响目标；不新增关键词路由 — 55778a8
- [x] Task: U12 Safety TDD——effect 机械关联可追溯 user 原话 provenance；target/action 语义由真实 LLM 动态映射并以 Story Eval 验收，不用关键词门复刻意图分类；合同合法但与目标无关的 effect 不得通过真实安全批次 — 55778a8 / b80efbc
- [x] Task: U13 Eval/TDD——复合“总结后归档”分阶段执行，临时回答与高风险确认分离，确认前状态不变 — 55778a8
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — 55778a8

## Phase F: 动态 action/capability 处境(U14–U17) [checkpoint: b80efbc]

- [x] Task: U14 Eval/TDD——经 `_meta` 激活测试 action 后下一轮真实 LLM 自动发现；源级断言没有新增关键词、prompt 示例或 chat route 特判 — b80efbc
- [x] Task: U15 Eval/TDD——正式摘要保存动态发现 capability/schema/scope，产出带 provenance artifact，再经 action 持久化/选择/确认 — b80efbc
- [x] Task: U16 Eval/TDD——无 summarize capability 时临时摘要仍成功，保存请求诚实报告持久化能力缺口且零静默写入 — b80efbc
- [x] Task: U17 Eval/TDD——处境同时披露授权 facts/links/actions/capabilities/guards/goal constraints，并排除无关 app/scope；不再 action-only 压缩实体 — b80efbc
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — b80efbc

## Phase G: 人机对称、解释与 provenance(U18–U21) [checkpoint: b80efbc]

- [x] Task: U18 TDD——同 principal 下 renderer 与 LLM 消费的字段集合等价；权限过滤差异有明确合同来源 — b80efbc
- [x] Task: U19 TDD——human renderer 与 Assistant 的同语义写请求落同一 action/裁决/事件合同 — b80efbc
- [x] Task: U20 Eval/TDD——“为什么执行”从授权消息、目标、action、guard/confirmation 和事件链生成解释；缺授权时承认错误 — b80efbc
- [x] Task: U21 TDD——日志和 context schema 区分原话、解析意图、合同事实、LLM 推导、artifact、action 与 human decision，重放保持 provenance — b80efbc
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — b80efbc

## Phase H: 全故事闭环与产品方向同步

- [x] Task: U1–U23 canonical 全过且 Safety 100%；固定 canonical + 四变体的 115 场景 corpus。当前机制闭环以真实 canonical/focused Eval 为准；完整变体质量批次与人工 rubric 留给后续廉价 judge/release gate，不以 fake driver 冒充 — b80efbc
- [x] Task: 回归 `pnpm check`、`CI=true pnpm e2e`；真实 LLM story-eval 生成可审计报告，确认无 rule/scripted 通过路径 — b80efbc
- [x] Task: 源级治理——禁止产品 runtime rule-driver imports、Assistant story fake driver、故事专用关键词/正则/route 分支和 action-only LLM 实体摘要 — b80efbc
- [x] Task: 同步 `GOAL.md`、`conductor/product.md`、`conductor/refs/arch-brief.md`、`DECISIONS.md` 与 DONE 报告，明确 T15 supersede 的旧 AI-optional/I1 口径 — b80efbc
- [x] Task: 真实 walkthrough——复走总结第一篇、多轮纠正、不保存约束、歧义澄清、明确下线、复合总结归档、新 action/capability 激活、inline/render/delegated provider profile 与 LLM 故障安全 — b80efbc
- [x] Task: Final Phase Verification & Checkpoint (Refer to workflow.md) — b80efbc

## Phase: Review Fixes

- [x] Task: Apply review suggestion——同步 `product-guidelines.md` 中仍残留的“零智能完整”旧口径为 AI-first 诚实降级 — dcb9552
- [x] Task: Apply review suggestion——移除会话测试 fixture 中的真实 baseline 模型名，保持 provider-neutral 源码治理 — 02e7dc8
