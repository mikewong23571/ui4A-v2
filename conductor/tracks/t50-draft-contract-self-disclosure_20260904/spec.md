# T50 定义提案合同自披露 — Spec

> 状态:new(2026-09-04)。自治规划(workflow.md 协议);设计经用户会话逐轮裁定,
> 愿景对齐(product-vision.md)已完成映射。起源:ui4a-ops 外置 Agent 实证 GAP-3
> (application bundle payload 格式不可发现,12 版盲试后需人问实现侧)与 GAP-4
> (`application:` 前缀绕过已安装冲突守卫)。

## 1. 背景与问题

T48 上线后,新 Application 出生机制完整,但**格式知识不在合同里**:

- `meta/drafts` create/revise 动作的 `payload` 字段是自由格式 `{}`——恰好在最重要的
  字段上,"schema 声明需要什么"的架构主张失守;
- 校验错误一次一条、只说"形状非法"不说期望形状——违背"拒绝是带可行动理由的事件"
  (I6 精神)的可行动性;
- 服务端不留存已消费的 seed、导出格式无 seed、`bundles validate` 不适用——站点上
  无任何可发现的格式样例;
- 外置 Agent(仅持公开凭据)实证代价:12 个 Draft 版本、5 种 seed 形状盲测、最终
  需人向实现侧询问格式——认知税转嫁给人,违反北极星 §〇"知道是系统的职责"与
  注意力判据。

同时存在一个实现缺陷(GAP-4):application-bundle 的 target 未校验裸名格式,
`--target application:todo` 绕过已安装冲突守卫,批准会出生字面名带前缀的重复应用。

## 2. 目标(Goal)

**G1 合同自披露**:定义提案的 payload 期望形状从合同可读——人(RJSF)、AI(chat
exec 工具 schema)、外部 agent(CLI)经**同一份投影**获得,不需要文档、不需要试错、
不需要问实现侧。

**G2 拒绝可行动**:形状类校验拒绝携带**结构化期望形状数据**(机械消息不变,数据
说话)——各门自行消费:CLI 原样打印、chat LLM 翻译成人话、浏览器结构化呈现。

**G3 守卫补漏**:application-bundle target 必须是裸 application 名
(`^[a-z][a-z0-9-]*$`,与 flow genesis 同口径),前缀即拒绝并留痕。

**G4 CLI 探测语法糖**:`ui4a drafts schema [--kind …]`——纯合同消费(fetch +
打印注解携带的 schema/example),CLI 不拥有真相。

## 3. 设计决定(实现前落 DECISIONS D69)

- **D69.1 落位=action 字段注解**:payload 字段保持对 RJSF 的现有形态,新增注解
  关键字 `x-ui4a-payload-schemas`,值 `{ <kind>: { schema, example } }`。理由:
  (a) chat 的 exec 工具投影"保留原字段 schema"(tools.ts),注解随字段全量到达
  模型——P6b 已证 kind 枚举走过此路;(b) RJSF 忽略未知关键字,人类表单零退化;
  (c) 避免 `oneOf` 三分支退化(flow/agent 宽松分支会吞掉一切约束);
  (d) 与"披露收窄发生在 prompt 层,不窄化 HTTP 合同"的 CLI 兼容纪律一致。
- **D69.2 schema 有界**:engine 从 `parseApplicationBundle` 同一合同派生**结构层**
  schema——顶层必填键、类型、**seed 条目四必填形状**;flows[]/nodes[] 等深层自由
  区域保持开放类型。跨字段引用(flow∈flows、node∈flow)不进 schema,交给服务端
  裁决 + D69.3。尺寸约束:注解序列化后不超过既有 action schema 的量级。
- **D69.3 拒绝数据化**:`DraftValidationIssue`(packages/shared)增加可选
  `expected?: unknown` 字段;形状类解析错误(seed 条目、顶层必填键等)在 issue 上
  携带期望形状的结构化数据(schema 片段或形状描述)。**机械 message 文案不改成
  "友好模板"**(product-vision §六 文案滑梯:机械层只产结构化原因,人话是 LLM
  原生认知)。
- **D69.4 守卫**:application-bundle create(与激活重验)对 target 施加与 flow
  genesis 相同的 IDENTIFIER 校验(提取共用常量);违规 guard-failed + rejectionEvent
  留痕(I6)。
- **D69.5 语法糖**:`drafts schema` 读取 `meta/drafts` 实体动作注解并打印;可附
  `--kind` 过滤。CLI 零新依赖、零内嵌真相。

## 4. 用户故事与验收(两门同跑)

| # | 故事 | 断言 |
|---|---|---|
| US1 | 外置 Agent 自足起草 | 仅持公开凭据+CLI(无外部文档),构造合法 application-bundle Draft 的 create/revise 迭代 ≤2 次(对照实证基线 12 次);`drafts schema --kind application-bundle` 一步给出 schema+example |
| US2 | 合同三可见 | `entities get meta/drafts` 的 create 动作 fields 含 `x-ui4a-payload-schemas`(CLI 原样);chat exec 工具 schema 含同一注解(meta-parity 测试扩展);浏览器合同测试确认 RJSF 渲染零变化 |
| US3 | 拒绝可行动 | seed 条目形状错误的 Draft issue 携带 `expected` 结构化数据(合同测试);错误消息仍为机械描述(无友好模板,评审项) |
| US4 | 守卫闭合 | `--target application:foo`(前缀/非法字符)guard-failed + 事件留痕;裸名不受影响;激活重验同判 |
| US5 | 复盘走查 | ops 故事重放:用注解 schema 直接构造 payload → 一次 create 即 ready;记录于 evidence |

## 5. 非目标(Out of Scope)

- flow/agent kind 的全量 payload schema(宽松现状维持;有需求另立);
- RJSF 改为合同驱动编辑器(注解本期对人类表单透明;远期 track);
- chat 对拒绝的"人话渲染"改进(LLM 原生认知,零代码);
- ui4a-ops `BUNDLE-FORMAT.md` 收缩为合同指针(发布后的 ops 侧跟进,不在本仓库);
- 错误消息批量重写(仅形状类 issue 增补数据字段)。

## 6. 验收标准

1. US1–US5 全过;US1 的步数对照与 US5 复盘记录入 evidence;
2. 愿景对齐评审通过:同一扇门(一份注解三门消费)、不窄化 HTTP 合同、读一个实体
   替代学一个格式、无文案滑梯(新增错误面 grep 无"友好模板"字符串拼接);
3. `pnpm check`(governance strict)+ `CI=true pnpm e2e` + `CI=true pnpm e2e invariants`
   全绿;既有 meta/chat/CLI 合同测试零回归;
4. DECISIONS D69 先行落盘;里程碑可运行(`pnpm dev:all` 起服实测 US1/US2)。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 注解撑大 tool schema/context | D69.2 尺寸约束;挂在动作上按需到达(分层披露);e2e 断言注解序列化尺寸上限 |
| 注解关键字被某层剥离 | 三门各自的合同测试固定(P6b meta-parity 扩展 + CLI envelope + RJSF 零变化) |
| shared 类型扩展波及面 | `expected?` 可选字段,向后无破坏;db 持久化 validation 原样透传 |
| 守卫误伤既有合法名 | IDENTIFIER 与 flow genesis 同口径(已在线上语义);e2e 回归既有 create |
