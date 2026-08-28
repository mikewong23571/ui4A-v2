# T36 实施计划:治理例外清退(重构与功能拆解)

> 依据 [spec.md](./spec.md)。治理原则(2026-08-28 用户授权)约束所有任务:拆分沿功能边界;不为指标机械挪动;模块不膨胀;证据不删除;零行为变化。
>
> 通用验收纪律(每任务):`pnpm governance` 全绿(收缩与对应基线条目移除**同 commit**);受影响测试全绿;`pnpm format:check` 通过;Conventional Commit + git notes。纯结构性搬移不强制新红测,以现有套件为安全网;凡引入新模块边界语义(fail-guard 提取、orchestration helper、@ui4a/db 包面),先写/迁移针对新边界的测试再动实现(TDD)。

## Phase A 呈现面拆解(web components/canvas;FR1.1、FR1.2、FR2.2)

- [x] Task: A1 surface-host 装配编排提取为 hook(FR1.1) `d923211`
  - [ ] 盘点 `presentation-surface-host.tsx` 的 load 取值/装配/failure 分支边界,确定 hook 契约(输入、载入状态、denied/unknown 分流、surfaceSubmit 回流)
  - [ ] 新建 hook 模块(领域命名,如 `use-presentation-surface-load.ts`),迁移编排逻辑;宿主保留装配+渲染;现有组件测试(presentation-surface-host 相关)全绿
  - [ ] 验证:受影响 vitest 套件全绿;文件 ≤500 行;移除基线条目 `presentation-surface-host.tsx` 同 commit
- [x] Task: A2 floating-chat 测试分片与共享 SSE 桩(FR1.2) `9b9fd19`
  - [x] 按 feature(presence attach/thinking 折叠/失败分层/SSE 生命周期等实际 describe 结构)分片为多个 `.test.tsx`;提炼共享 SSE 桩到就近 kit/辅助模块
  - [x] 用例只迁移不删除;vitest 套件全绿;各分片 ≤800 行
  - [x] 移除基线条目 `floating-chat.test.tsx` 同 commit
- [x] Task: A3 components 直接文件按 feature 归档(FR2.2) `05238e7`
  - [x] 以现值实测为导向,把 chat 面板族/画布族等直接文件归档进既有 `chat/`、`canvas/` 或新建 feature 子目录;import 路径与相关测试引用同步;**不做任意对半切**
  - [x] 验证:目录直接 `.ts/.tsx` 合计 ≤4000 行;`pnpm --filter @ui4a/web build` 通过;移除基线条目 `apps/web/src/components` 同 commit
- [x] Task: Phase A 检查点(自动化等效验证:相关 vitest 套件 + `pnpm governance`;git notes 记录拆分边界) `05238e7`

## Phase B 服务编排拆解(FR1.3、FR1.4)

- [x] Task: B1 chat route 编排提取(FR1.3) `ad55064`
  - [x] 识别 route 内编排段(SSE 生命周期/流分段/错误分层/决策投影接线),提取 orchestration helper 模块(如 `src/chat/route-orchestration.ts` 或邻近期 chat 模块);route 收缩为路由壳
  - [x] 先迁移/补齐针对 helper 的单测(红→绿),再搬实现;chat 合同测试(SSE/history/recovery)全绿
  - [x] 文件 ≤500 行;移除基线条目 `chat/route.ts` 同 commit
- [x] Task: B2 service.ts flow 别名解析段提取(FR1.4) `37e7938`
  - [x] getEntity/exec 的 `flow:<name>` 别名解析段并入 `flow-entry.ts` 装配边界(基线 note 既定处置);`pnpm --project unit` + service-tests 全绿
  - [x] 文件 ≤500 行;移除基线条目 `service.ts` 同 commit
  - [x] 注:若 Phase E 采取组合根下沉形态(a),本任务先做最小提取保收缩,E 阶段再深化,避免重复拆
- [x] Task: Phase B 检查点(chat 全套件 + service-tests + governance;git notes) `37e7938`

## Phase C 纯内核与 agent loop(FR1.5、FR2.1)

- [ ] Task: C1 engine/presentation 直接文件子域归档(FR2.1)
  - [ ] 直接文件(broker/compose/composition-fastpath/lens/patch/promotion/scenario/sidecar 等)按 compose/recipe/sidecar 子域归档;`index.ts` 公共导出面**不变**(@ui4a/engine barrel 消费者零改动)
  - [ ] 验证:`pnpm --filter @ui4a/engine test` 全绿;目录直接文件合计 ≤4000 行;移除基线条目同 commit
- [ ] Task: C2 agent loop fail-guard 家族提取(FR1.5)
  - [ ] 先把反复拒绝机械收敛护栏的既有断言固化为针对新模块的红测,再提取 fail-guard 模块;循环终止判定单一可读(T35 C5 语义不回退)
  - [ ] 文件 ≤500 行;`pnpm --filter @ui4a/agent test` 全绿;移除基线条目 `loop.ts` 同 commit
- [ ] Task: Phase C 检查点(engine+agent 全套件 + governance;git notes)

## Phase D 部署合同与 e2e 域分解(FR1.6、FR1.7、FR2.4、FR2.5)

- [ ] Task: D1 scripts/t22 按部署子域分目录(FR2.4)
  - [ ] 建 `scripts/t22/{compose,k8s,keycloak,backup}/` 子域目录,文件按域归档(backup/recovery 归 backup;helm/pki/runtime 归 k8s;realm 归 keycloak;compose 归 compose;跨域共用件留在顶层或 shared,以引用实态裁定)
  - [ ] 同步全部路径引用:`package.json`(`migrate:production`、`compose:t22`)、`docs/t22-production-runbook.md`、`deploy/compose/acceptance-contract.json`、测试内相对引用
  - [ ] 验证:`pnpm vitest run scripts/t22` 全绿;顶层直接文件合计 ≤4000 行;移除目录基线条目同 commit
- [ ] Task: D2 两个 t22 合同测试 describe 分片(FR1.6、FR1.7)
  - [ ] `t22-helm-contract.test.ts`(983)与 `t22-compose-contract.test.ts`(866)按部署关注点分片为多个 ≤800 行测试文件;断言不删减
  - [ ] 移除两条文件基线条目同 commit
- [ ] Task: D3 e2e 域归档(FR2.5)
  - [ ] 顶层 spec 按业务域归档子目录(不变量/交互/workstation/meta 等;延续 `kits/`、`interaction/`、`workstation/`、`eval/` 既有模式);playwright 配置的 testDir/glob 兼容性验证
  - [ ] 验证:`CI=true pnpm e2e invariants` 抽样 + 全量 e2e 留 Phase F;顶层直接文件合计 ≤4000 行;spec 数量不减;移除基线条目同 commit
- [ ] Task: Phase D 检查点(vitest scripts/t22 + e2e invariants + governance;git notes)

## Phase E GR1 例外清退(FR3.1、FR3.2、FR2.3)

- [ ] Task: E1 @ui4a/db 抽包(FR3.1、FR2.3)
  - [ ] 新建 `packages/db`(@ui4a/db):迁移 `apps/web/src/db` 全部源与测试,内部按域组织(既有文件即域划分,不设聚合 barrel 垃圾场;顶层只留必要入口);`pg` 依赖声明入包
  - [ ] 先扩展治理门禁:`check-deps.mjs` MODULES/ALLOWED 增 `packages/db`(允许→shared;web/worker 增补允许;engine/agent/shared 禁止)+ BANNED_EXTERNAL 相应条目
  - [ ] 工程接线:根/子包 package.json workspace 依赖、tsconfig paths(去掉 worker 的 `@/*`→web 映射与 jsx 注释)、vitest `--project db` 工程指向迁移后的测试路径
  - [ ] 双端改引:web 与 worker 27 文件的 `../../web/src/db/*` 全部改为 `@ui4a/db/*`(直接改引,不留 re-export 壳;web/src/db 目录删除)
  - [ ] 文档同步:AGENTS.md 系统图、模块职责段、依赖方向句;DECISIONS.md 记录包边界决定
  - [ ] 验证:`pnpm --project db` 全绿(重放/迁移/recovery 套件)、web/worker 全套件、`pnpm governance`(例外 #1 退役,同 commit 从 exceptions.json 移除;apps/web/src/db 目录基线条目随之消失,一并移除)
- [ ] Task: E2 引擎组合根处置(FR3.2)
  - [ ] 调研并裁定形态:(a) 组合根下沉为包内装配模块(web service.ts 与 kill 测试共用真身,与 B2 协同)优先;(b) 共享测试 harness 包。裁定与理由记入 DECISIONS.md(D53 或独立条目)
  - [ ] 实施:消灭 `delegation.kill.integration.test.ts` 对 `apps/web/src/engine/service` 的 import;kill 测试仍走真 HTTP + 真 PG + 真 Temporal,断言不降级
  - [ ] 验证:kill 集成测试在 Temporal/PG 可用时全绿(不可达按既有口径跳过并说明);`pnpm governance`(例外 #2 退役,同 commit 移除)
- [ ] Task: Phase E 检查点(db/web/worker 三端全套件 + kill 集成 + governance;git notes)

## Phase F strict 接线与收口(FR4)

- [ ] Task: F1 清空登记(FR4.1)
  - [ ] 确认 12 条基线全部退役、2 条例外全部退役;`size-baseline.json` 置空结构、`dependencyExceptions` 置空数组;compatAllowlist 8 条原样保留
- [ ] Task: F2 strict 并入 pnpm check + 治理文档(FR4.2、FR4.3)
  - [ ] `package.json` `check` 脚本的 governance 段改为 strict 形态;`pnpm check` 全绿
  - [ ] DECISIONS.md 新增 **D53**:strict regime、GR3 膨胀处置转为"变更时沿功能边界拆解"、例外登记逃生门退役、@ui4a/db 包边界(若 E2 未单列则并入)
  - [ ] workflow.md 业务优先节修订 + AGENTS.md GR3/GR4/模块职责同步;tech-stack.md 如涉及新包登记
- [ ] Task: F3 全量验证与归档(FR4.4)
  - [ ] `pnpm check`(含 strict)+ `CI=true pnpm e2e` 全绿;系统可运行性实测(`pnpm dev:all` 起后 smoke)
  - [ ] `conductor/tracks.md` 归档 T36;完成报告 git notes
- [ ] Task: Phase F 检查点(全量门禁 + e2e + smoke;git notes 终验报告)

## 风险与既定缓解

- **移动类改动引用面大**:每任务独立 commit,失败即 `conductor-revert` 单任务回滚,不阻塞后续。
- **E1 是最大机械面(27+ 引用文件)**:先改门禁与包骨架(Red:依赖图未接好时测试失败),再按端分批改引,任一时刻 governance 可红可回退。
- **e2e/playwright glob 兼容**:D3 先跑 invariants 抽样再全量(F3)。
- **strict 接线后的政策一致性**:F2 必须同批完成 DECISIONS/workflow/AGENTS 三处同步,避免"门禁已严、文档仍教登记"的矛盾态。
