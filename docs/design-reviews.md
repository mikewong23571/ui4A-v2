# 设计评审记录

本文档是 UI4A 代码库设计评审的**唯一存档处**:每次专项评审追加一个带日期的章节;评审产生的每个问题分配稳定编号(章节内自增,如 R1/R2),供后续提交信息、DECISIONS.md 与任务合同引用。

使用约定:

- 问题状态只原地更新(`open` → `fixed` / `accepted-risk`),不删除条目——评审档案本身就是审计轨迹;
- 编号命名空间按章节隔离,引用时写作「设计评审 2026-08-27 §引擎基础层 R1」;
- 评审必须写明方法(读了什么、跑了什么)与未验证的部分,诚实边界。

---

## [2026-08-27] 引擎基础层(core / contract / execution)— `packages/engine`

- **范围**:`packages/engine/src` 下 `core/`、`contract/`、`execution/` 全部 17 个非测试源文件(约 4200 行),以及 `purity.test.ts`、governance 报告与 web 侧消费点抽样。
- **方法**:逐文件通读;核对 arch-brief §2/§3/§9 不变量(裁决顺序、guard 纯度、拒绝即数据、plan 批量裁决、审计诚实性);运行 `pnpm governance`;grep 核对 `actionRejectedEvent` / `projectExecutionAudit` / `executeWithGates` 在 apps/web 的消费。
- **未验证**:12 个测试文件未深读;未执行单元测试。R1 是否已被某测试固化为期朧行为未核实。

### 总评

设计纪律高:不变量靠结构而非约定维持。裁决顺序单点落实,纯度由文本级测试强制,复杂度集中在确认门与效果词汇表这两块有真实语义的地方(judge+plan+execute ≈ 510 行)。主要债务不在裁决本体,而在三处「同口径」知识的复制。

### 做得对的

- **裁决顺序不变量单点落实**:judge(`execution/judge.ts:145`)一个函数实现①声明→②guard→③schema;`executeWithGates`(`execution/execute.ts:68`)在其后插确认门;plan 每步原样复用 `executeWithGates`(`execution/plan.ts:97`)。全库仅此一处裁决顺序,由结构保证而非注释约定。
- **纯度是真强制**:全部源文件只 import `xstate`/`ajv`/`@ui4a/shared`;`purity.test.ts:27` 对库源做文本级扫描(Node 模块、process/Buffer)+ barrel 完整性断言。事件无时间戳(seq/ts 日志层分配),id 与实例命名全为确定性计数器——重放友好是一致的形态选择。
- **拒绝即数据、审计不编造**:拒绝带 layer/reason/detail 结构化落盘(web 侧 `service-confirmation.ts`/`service.ts` 均消费);`execution/execution-audit.ts:250` 无法核实授权时标 `authorization-error` 而非补造原因,旧日志缺 detail 时诚实降级。
- **关键取舍就地注释质量高**:FNV-1a 版本号 vs sha256 内容寻址的界限(`contract/sitemap.ts:7-9`)、投影空参数求值 fail-closed 双投影口径(`contract/siren/build.ts:3`)。

### 问题

| 编号 | 严重度 | 状态 | 问题 |
|---|---|---|---|
| R1 | 中高 | open | approve 存在 TOCTOU 缺口 |
| R2 | 中 | open | EngineSnapshot 组装样板三处复制 |
| R3 | 中 | open | action 定位三轨实现 |
| R4 | 低中 | open | `normalizeAddedAction` 手工镜像私有函数 |
| R5a | 低 | open | 审计授权核验用子串包含,证据强度弱 |
| R5b | 低 | open | Ajv 每 exec 重建编译器 |
| R5c | 低 | open | 字段整字段覆盖可静默放松约束 |

**R1【中高】approve 的 TOCTOU 缺口。** 挂起时三层全过;批准时只复核「目标动作仍声明于当前节点」(`confirmation.ts:406-414`),不重跑 guard、不重校 schema(注释明言「此处不重新裁决」,`confirmation.ts:372-373`)。挂起到人类批准之间,其他动作可能改变状态使 guard 已不满足(如 is-pending 变 false),效果仍照常应用——transition 有 `canTransition` 兜底,guard 没有。可能是有意的人信任设计,但 arch-brief「每次命中仍重新授权」的口径在确认门侧不成立。最低成本修复:approve 时对 target-action 重跑 guard 层(`evaluateGuards` 就在手边);或至少在 DECISIONS.md 记录取舍。修复前需先核实是否有测试已把现行为固化为契约。

**R2【中】快照组装样板三处复制。** `applyEffects` 尾部(effects.ts:387-413)、`suspendForConfirmation`(confirmation.ts:201-226)、`rejectConfirmation`(confirmation.ts:523-548)各自手抄整张 EngineSnapshot 十余张表的搬运。applications/capabilities「仅在场时携带」的 vacuous pass 过渡语义(effects.ts:400-410)是最容易在重构时静默丢失的条件。建议抽 `withTables(snapshot, overrides)` 收口并配一条与 fold 重放的等价测试。当前加一张新快照表的爆炸半径 = 所有手抄点。

**R3【中】action 定位三轨。** `executeWithGates` 手里已有 `verdict.action`,`applyEffects` 却从 flows/versions 自行重解析一遍(effects.ts:258-261);加上 judge 与 approveConfirmation,同一「instance→node→action」定位共三份实现。bornVersion 口径靠 `flowForInstance` 统一了注册表层,没统一到定位层。建议 judge 把 resolved `{flow, node, action}` 放进 accepted 结果下传(approve 的独立重定位是故意的漂移检测,应保留)。

**R4【低中】镜像私有归一化函数。** effects.ts:178 重写 parse.normalizeAction(parse.ts:349,未导出),自称同口径——parse 未来新增默认值键时 meta add-action 会静默漂移。要么导出复用,要么加锁等价的耦合测试。

**R5a【低】审计授权证据弱。** `auditAuthorization` 用 `content.includes(quote)` 子串包含(execution-audit.ts:141):1 字符 quote 即可过 verified。audit-only 故危害有限,提升便宜(最短长度/字级交集)。

**R5b【低】Ajv 热路径浪费。** 每次 judge / rejectConfirmation 都 `new Ajv()` + compile(judge.ts:192、confirmation.ts:493)。可按 schema 内容缓存 compiled validator。

**R5c【低】字段覆盖脚枪。** `mergeFieldDefinitions` 整字段覆盖,注释说「动作可收紧约束」(schema.ts:70),机制上同样允许放松(required 丢失、type 换掉),声明侧无一 invariant 拦截。可在激活不变式中补一条覆盖不得改变 base field type。

### 观察(记录即可)

- **XState 目前是装饰性的**:machine config 无 guard/context,`canTransition` 本质是 Set 成员查询 + 每次调用建 machine(machine.ts:56)。架构决定绑定了它,保留没问题,其价值要在 transition 引入条件 guard 后才兑现。
- **meta 投影 O(N×M)**:`projectCapabilities` 每个 capability × 每个 application 全量跑 `exportDefinitionBundle` 反查链接(project-meta.ts:361-365)。demo 规模无事,扩容前需索引化。
- **sitemap 集合面 app 归属依赖入参序**:取「首次 append 的 flow」,换调用序就换 version(sitemap.ts:253-279),确定但不稳,已有文档注明。
- **体积分布印证设计意图**:真正复杂的不是裁决循环,而是确认门(551 行)与效果词汇表(416 行)。`project-meta.ts`(515 原始行)是 GR3 上限边缘的下一个拆分候选(有效行仍在限内,三个原始行超 500 的文件均未登记 size baseline)。

### 结论

下一步优先级:修 R1(或记录取舍)> 抽 R2 快照 helper > 收敛 R3 定位双轨。其余按顺手时机处理。

### 备注

- 评审当日 `pnpm governance` 失败,原因是 e2e 目录基线增长(4536 > 4507),与本层无关;非测试文件均过有效行门槛(GR3)。
