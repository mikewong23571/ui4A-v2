# T26 工作线投影 — Specification

## 类型

Feature(投影模型;spike → 实施;零新真相)

## 背景与动机

用户的工作单位不是应用,是"一件事":特性开发的 track、一轮 CVE 战役、一个
bugfix。conductor 的 track 目录就是这个聚合的人工文件版。今天目标、上下文
实体、进行中的 flow/run、待批准项、事件全部以散落投影存在,没有任何对象把
它们聚成"一条线"。工作线是 scoped context 的真正载体:首页的主角、AI 上下文
的边界、"我上次干到哪了"的答案。方向依据:product-vision.md §三/§四。

## 站点归属

投影层(引擎/DB),本身无站点;消费方是 workstation 站(T27)与 assistant
上下文(T25 的 scope 边界将来由它承接)。

## Phase 0:Spike(必须先回答,产出 DECISIONS 条目)

1. **成员资格**:什么把实体/事件归入一条线?候选:goal 锚定(chat turn 声明)、
   人类显式 pin、会话隐式聚合、rel 引用图自动扩张。允许组合,但主规则必须
   声明式(数据),不是代码分支。**约束(CLI 纪律二):主规则必须由事件中的
   显式引用聚合(exec/goal 携带 thread 锚),不得仅由 presence/会话隐式推导——
   否则 CLI/外部 agent 的工作落在线外,人机两世界。**
2. **生命周期**:线的创建/暂停/完成/归档由什么事件界定?能否跨 session?
   (预期:能;durable 如 sidecar,key 绑定 principal 而非 sessionId。)
3. **跨 scope 引用**:上下文包跨应用/跨平面(business/meta/外部系统投影)
   的表示法;与 sidecar key 的 policyScope 维度如何对齐。
4. **与既有对象的关系**:chat session、delegation、flow 实例、confirmation
   如何被"收编"而不产生第二真相;线与 track(conductor)概念的命名与映射。
5. **在场锚点**:线的进入/离开是否复用 T29 presence 事件(预期:是——
   presence 只记锚点,成员资格仍按第 1 问的显式引用聚合)。

## 最终形态(实施目标)

1. **`threads` 集合与 `thread:<id>` 实体**:纯 fold 投影(与
   delegations/inbox 同族),重放可重建,hash 一致。
2. **实体内容**:目标(goal 原文与来源消息)、上下文包(显式链接的实体
   rel 集,跨 scope 保留 scope)、进行中(flow 实例/agent run/delegation
   实时状态)、待批准(关联 confirmation/activation/draft)、事件切片
   (本线 rel 前缀或显式关联的事件流)。
3. **归属规则声明式**:成员资格由事件中的显式引用(goal/thread 字段)聚合;
   引擎只做 fold,零 `if type === …` 分支(规则滑梯红线)。
4. **合同暴露**:`threads`/`thread:<id>` 进业务 sitemap,人类与 agent 同读。

## Scope 边界(非目标)

- 不做任何 UI(workstation 首页归 T27);
- 不做线的 meta 定义治理(线类型/模板经 meta 定义——后续 track 候选);
- 不引入新事件 domain 之外的写路径(线的创建/更新仍是普通业务事件);
- 不做外部系统投影(MR/流水线/CVE 情报——应用内容,后续 track)。

## 施工纪律红线

- 纯投影:零新真相,重放 hash 与现状等价(除新增投影本身);
- 成员规则声明式数据驱动,无每工作类型特判代码;
- 线的 key 绑定 principal,不绑定 session。

## 验收方向

- spike 产出:五个问题的 DECISIONS 条目与否决项记录;
- fold/重放测试:投影可重建、终态 hash 一致;
- 合同测试:`thread:<id>` 实体的 Siren 形状(links/actions/guard-results);
- **CLI 对照:经 CLI(显式 thread 锚,无 presence)完成建线/挂载/查态/
  审计全流程——同一场景两种执行者各跑一遍;**
- 不回归:invariants 与既有投影测试全绿。
