# T55 架构治理落地:审查结论 → 决策 → 门禁 → 重构(spec)

- 输入:[`arch-review-2026-09-05.md`](../../../arch-review-2026-09-05.md)(v2,2026-09-05,经数据审计 + 架构对抗评审双重独立审核,断言均经二次核验)
- 类型:remediation(架构治理);验收协议按 `conductor/workflow.md`(编排 agent 代行验收,notes 标注「自治验收」及验证证据)
- 状态图:`new` → 实施中 → 归档

## 1. 背景与动机

2026-09-05 的结构审查(经独立审核修订为 v2)确认了两类可操作残留:

1. **治理盲区**:GR2 的 legacy/compat 扫描只识别英文词形,中文兼容措辞不可见(N1,实例 `packages/shared/src/production-deployment-config.ts:2`「兼容深路径入口」);GR1 只扫 import 说明符,文件系统级反向耦合(`readFileSync` 跨包读源、`scripts/t22` 伸手 `apps/worker/node_modules`)不在例外登记内(N2);GR3 目录限额报告不含测试/非测试分列,导致「贴限」不可解读(A04:濒限目录 57–77% 是测试行)。
2. **两个已确认的重构靶点**:`apps/web/src/app/api/chat/route.ts`(57 次触达全库第一,单一 ~415 行 POST;D52 已把收缩窗口「改挂在下一次 chat 编排重构」)与 `apps/web/src/engine/service.ts` 的 `exec()` 闭包(~230 行业务编排;hub 已拆 10 个 `service-*` 但编排没拆;存在 `ExecOutcome` type-only 环状依赖 `service-confirmation.ts:29`/`service-thread.ts:12` → `./service`)。

另有文档真源漂移:AGENTS.md 系统图缺 D34/D36 引入的第四应用 `apps/agent-runner`;arch-brief §8.1 仍列已迁至 `packages/db` 的 `apps/web/src/db/presentation`。

## 2. 目标(Track Goal)

把审查结论按「决策先行 → 门禁修补 → 文档对齐 → 重构落地 → 复测收口」的顺序全部处置完毕,使:治理门禁能看见本库真实语言与真实依赖形态;两处最高价值编排热点完成沿职责边界的分解且行为不变;架构文档与事实一致;并留下可复跑的度量对比证据。

## 3. 非目标(Out of Scope)

- **presentation 源码改名**(审查候选 6 已降级:纯 churn,缓做;仅修 arch-brief 陈旧路径)。
- **濒限目录机械预拆分**(审查候选 3 原案已撤回;D53 已禁机械切分,本 track 只改报告可见性)。
- **apps/web 拆包/分压**(A01 无操作项:分层是 AGENTS.md 刻意分派,不在本 track 处置)。
- **chat 域五目录重组**(A03 的五目录分布是文档化设计;本 track 只重构 route.ts 编排,不动域目录结构)。
- **任何行为/合同变更**:Phase 3/4 是行为不变重构,HTTP 合同、事件形状、Siren 投影、审计语义零变化。

## 4. 范围裁定(规划期决策记录)

- **为什么 chat 与 service 两个重构放进同一个治理 track**:二者同源于审查的最高优先级(1/2),共享「决策先行 + 特征化测试 + 行为不变」方法论,且 D52 已为 chat 命名窗口;分立 track 会重复决策/验收开销。若 Phase 4 实施中发现与 T54 冲突面过大,允许只关闭 Phase 0–3 + 5 的文档/门禁部分,Phase 4 移交后继 track(须在 notes 记录移交裁定)。
- **t22 探针迁移降为可选**(P5.1,标 `[可选]`):D52 已裁定「路径与命名保留原样」,迁移属 D52 修订案,收益仅是位置语义;若 DECISIONS 修订未获通过则仅保留登记。
- **依赖与协调**:无硬依赖(`dependsOn: []`)。与在途 T54(ux-gaps)的潜在冲突面 = `apps/web/src/components`(确认卡片)与 chat 域外围;两 track 并行时,Phase 3 开工前须 rebase 检查 T54 是否已动 `app/api/chat/**`,冲突则串行化并在 notes 记录。

## 5. 功能需求(FR)

### FR1 治理盲区修补(对应 N1/N2/A04)

- FR1.1 `scripts/governance/check-compat.mjs` 的 `MARKER_RE` 增加中文词形(至少 `兼容|向后兼容|旧路径|遗留`);存量命中要么改写措辞、要么按 allowlist 机制登记(`pendingRemoval` 语义照旧);`check-compat` 自身测试覆盖中文词形检出。
- FR1.2 文件系统级跨包读依赖显式化:`scripts/governance/exceptions.json` 新增登记段(或等价扩展 `check-deps`),至少覆盖审查点名的三处——`packages/agent/src/governance/t21-source-governance.test.ts`(readFileSync×4 读 apps/web 源)、`t16-acceptance-matrix.test.ts`(依赖 e2e/kits)、`scripts/t22/t22-temporal-probe.ts`(import apps/worker/node_modules)——每条带 `reason` + `retireWhen`。
- FR1.3 `scripts/governance/check-size.mjs` 目录报告增加测试/非测试有效行分列;`pnpm governance` 报告可见(用于解读贴限:如 `engine/src/definition` 报告非测试 1,134)。

### FR2 文档真源对齐(对应 A05/A07)

- FR2.1 AGENTS.md「System and Application Map」补第四应用 `apps/agent-runner`,引用 D34/D36,标注 experimental 状态与其部署链路(DEPLOYMENT.local.md/release manifest),修正「三个可部署应用」表述。
- FR2.2 `conductor/refs/arch-brief.md` §8.1 移除/修正 `apps/web/src/db/presentation` 等已迁移路径(指向 `packages/db`)。

### FR3 chat POST 编排重构(对应 A03;D52 命名窗口)

- FR3.1 `route.ts` 的 POST 分解为四段职责模块:鉴权/身份(bearer、delegated identity)、请求体解析校验(复用既有 `src/chat/request-body.ts` 语义)、会话编排(start-chain/thread 决策)、SSE 流式响应(复用 `src/chat/sse.ts` 语义);`route.ts` 收缩为编排壳。
- FR3.2 分解落位:`src/chat/` 或 `app/api/chat/` 邻域模块(实施期按「附近模式优先」裁定,写入 D75);**不**新增域目录、**不**移动既有 chat 域模块。
- FR3.3 行为不变:9 个既有测试文件(`route.test.ts`、`route.production-auth.test.ts`、`route.delegated.test.ts`、`route.meta-parity.test.ts`、`route.render.test.ts`、`route.step-frames.test.ts`、`route-ai-first.test.ts`、`route-audit.test.ts`、`read-routes.production-auth.test.ts`)断言零删除、语义零变化,全绿。

### FR4 service hub 降权(对应 A02)

- FR4.1 `ExecOutcome`(及 `PlanServiceOutcome` 若同环)下沉至叶子模块,消除 `service.ts ↔ service-confirmation/service-thread` type 环;以环检测命令(见 AC-4)输出为零环作证。
- FR4.2 `exec()` 闭包(~339–573 行)内的业务编排段——confirmation 路由、thread 串联、meta 特例、coding-result 预检、spawn-dispatch 准备、T52 `application-deprecated` 选择性 refold——沿既有 `service-*` 域模块归位或新建域模块;`service.ts` 只留装配 + 编排入口。
- FR4.3 不变量:单原子串行裁决语义不变(AGENTS.md「裁决器即并发控制」、D34);`src/engine/service-tests/` 全部测试断言零删除通过。

### FR5 卫生收尾(对应 A06/A10)

- FR5.1 `[可选]` t22 探针文件迁至 `scripts/t22/`(D52 修订案):更新 `t22-temporal-probe.ts` 的 `workflowsPath` 与 `t22-probes-source.test.ts` 断言;`scripts/t22` 套件全绿。
- FR5.2 `.next*` 构建根收敛:e2e/probe 构建共享单一构建根,或提供可复跑的回收脚本(验收时演示回收)。

## 6. 架构约束(全 Phase 生效)

1. 决策先行:Phase 3/4/5.1 开工前必须先有对应 DECISIONS 条目(D75/D76/D77);无裁定不动代码。
2. GR1–GR5 全程有效:本 track 不得新增基线条目(size-baseline 保持空)、不得新增未登记例外;给治理脚本自身加的中文词形不得误伤治理目录(沿用既有排除规则)。
3. GR2 自检:FR1.1 落地后,治理脚本与 spec/plan 中出现的「兼容」类中文词如触发扫描,须按 allowlist 机制登记为正当语义(勿用改写规避)。
4. 行为不变重构纪律(Phase 3/4):测试断言只迁移不删减;不为凑行数裁剪代码或证据(D53);事件/HTTP/Siren/审计合同零变化。
5. 提交规范:scoped imperative Conventional Commit;每 Phase 一个 checkpoint(照 `workflow.md` Phase Completion Verification 协议)。

## 7. 验收方案与条件(Acceptance)

> 验收协议:编排 agent 代行(workflow.md),每条 AC 关闭须在 track notes 留「commit + 验证命令 + 输出摘要」三元证据;测试断言零删除由 `git diff` 审查佐证。

### AC-0 决策先行(Phase 0 出口条件)

- DECISIONS.md 新增不少于 3 条裁定:D75(chat 编排重构:四段边界、模块落位、测试迁移策略)、D76(service hub 降权:ExecOutcome 落点、exec() 各编排段归位、单原子队列保持声明)、D77(t22 位置 D52 修订案,或明确记录「不迁移,保留 D52 原裁定」)。
- 开工前事实复核留痕:复验审查 v2 的关键断言(type 环存在、route.ts POST 行区间、贴限目录测试占比、D52 原文位置),断言仍成立才开工;不成立则先修 spec 并记录。

### AC-1 治理盲区(Phase 1 出口条件)

- AC-1.1 中文兼容词形被检出:`pnpm vitest run scripts/governance/check-compat.mjs 的测试`(或等价命令)含中文标记用例且通过;`pnpm governance` 全绿(存量经登记或改写)。
- AC-1.2 读依赖登记可查:`scripts/governance/exceptions.json` 含 FR1.2 三处登记(每条 reason+retireWhen);`pnpm governance` 不因新登记失败。
- AC-1.3 分列输出:`pnpm governance` 的 check-size 段对超限/贴限目录显示 test/non-test 分列;`engine/src/definition` 显示非测试约 1,134(±漂移)。

### AC-2 文档对齐(Phase 2 出口条件)

- `grep -n "agent-runner" AGENTS.md` 命中系统图段落且引 D34/D36;「三个可部署」表述已修正。
- `grep -rn "apps/web/src/db" conductor/refs/arch-brief.md` 零命中(或仅剩指向 packages/db 的正确表述)。

### AC-3 chat 编排重构(Phase 3 出口条件)

- `route.ts` 有效行 ≤ 200,且 POST handler 体 ≤ 150(编排壳);四段职责各自有独立测试文件覆盖(新增测试与既有 9 文件并存)。
- 既有 9 测试文件 `git diff` 审查:断言零删除;`pnpm --filter @ui4a/web test`(或 `pnpm vitest run` 等价)chat 相关全绿。
- E2E:`CI=true pnpm e2e` 中 chat 相关 spec 全绿(如存在 chat 专用 spec,点名列出)。

### AC-4 service hub 降权(Phase 4 出口条件)

- 零环:`npx --yes madge --extensions ts --circular apps/web/src/engine`(或等价 dpdm 命令)输出无 `service` 相关环;`ExecOutcome` 定义于叶子模块。
- `service.ts` 有效行 ≤ 350;`exec()` 闭包体内不再含 FR4.2 所列六类业务分支(由各域模块测试覆盖佐证)。
- `pnpm vitest run apps/web/src/engine/service-tests`(等价)全绿,断言零删除;`pnpm check` 全绿。

### AC-5 卫生收尾(Phase 5 出口条件)

- FR5.1 若执行:`scripts/t22` 套件全绿(workflowsPath 与断言同步更新);若 D77 裁定不迁移,notes 记录裁定即可。
- FR5.2:演示构建根回收或单一共享根(命令留 notes);本 track 之后 `apps/web/.next*` 根数 ≤ 2。

### AC-6 收口(Track DoD)

- `pnpm check`(含 `governance:strict`,size-baseline 仍为空)、`CI=true pnpm e2e`、`CI=true pnpm e2e invariants` 全绿。
- 复测报告:重跑 arch-review 的度量口径(churn 前二、贴限清单、GR 计数),与 v2 基线对比写入 track notes;`arch-review-2026-09-05.md` 各处置项标注已落地(指向 commit)。
- GR5 处置:本 track 的 bespoke 脚本/配置晋升为常设门禁或删除;track 归档,registry 打勾。

### 验证命令速查

```bash
pnpm governance                       # AC-1 全段
pnpm check                            # AC-3/4/6 类型+lint+治理+测试
CI=true pnpm e2e                      # AC-3/6
CI=true pnpm e2e invariants           # AC-6
npx --yes madge --extensions ts --circular apps/web/src/engine   # AC-4
```

## 8. 风险与回退

| 风险 | 缓解 | 回退 |
| --- | --- | --- |
| chat 重构破坏生产行为 | 特征化基线=既有 9 测试文件;断言零删除审查 | 按 Phase checkpoint revert(conductor-revert) |
| service 拆分移动了原子裁决点 | D76 先声明队列保持;service-tests 并发/裁决用例不裁剪 | 同上 |
| 中文词形扫描产生大面积存量误报 | Phase 1 先跑只读清单评估量,再决定「登记 vs 改写」比例 | 词形集收窄到审查点名的措辞 |
| 与 T54 冲突(apps/web/chat 外围) | Phase 3 开工前 rebase 检查;冲突则串行化 | 顺序调整,不影响各自 scope |
| madge/dpdm 引入临时依赖 | 仅验收命令(npx 临时),不入 package.json | 用 tsc + 手工 import 图佐证 |

## 9. 收口与归档

完成后按 workflow.md:GR5 处置 → notes 汇总(每 AC 的三元证据)→ registry 打勾 → `conductor/tracks/archive/t55-architecture-governance_20260905/`。
