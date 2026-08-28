# T36 治理例外清退:重构与功能拆解(反模块膨胀)

- Track ID: `t36-governance-exception-retirement_20260828`
- 类型: Chore / 重构治理
- 立项: 2026-08-28(用户指令"新增 track 处理此前治理的例外";治理方向授权"主要的治理方向是重构以及功能拆解,不应该让模块膨胀")
- 前置事实(2026-08-28 实测): `pnpm governance` 全绿但 `size-baseline.json` 余 12 条(7 文件 + 5 目录),`exceptions.json` `dependencyExceptions` 余 2 条;GR2 `compatAllowlist` 8 条全部 `pendingRemoval: false`(正当协议措辞,非债务)。

## 概述

把 T22–T35 期间按"业务优先登记例外"纪律积累的治理债务**全部清退**:通过重构与功能拆解让每个超限模块回到限内、让两条 app→app 依赖例外按其既定 `retireWhen` 路线退役,终态为 `governance:strict` 全绿并按 D52/GR4 并入 `pnpm check`。

本 track 不产出业务功能。它的交付物是:**更小、单一职责的模块边界 + 空白的例外登记 + 严格化的常驻门禁**。

## 治理原则(2026-08-28 用户授权,约束所有任务)

1. **重构与功能拆解是唯一清偿手段**:拆分必须沿功能/领域边界;禁止为凑行数指标做机械挪目录、任意对半切或裁剪代码。
2. **模块不膨胀**:
   - 拆出的新模块必须单一职责、有明确领域名;禁止纯转发的 wrapper/re-export 壳(GR2 无兼容窗口,web 侧对迁移模块**直接改引**,不留兼容别名)。
   - 新包(`@ui4a/db` 等)内部按域组织,不得成为聚合垃圾场。
   - 本 track 自身不得新增超限登记(shrink-only 全程生效)。
3. **验收证据不删除**:测试用例只迁移/重组/分片,不删减;e2e/t22 收缩只来自组织方式变化,不来自证据裁剪。
4. **零行为变化**:所有拆分以现有测试全绿为安全网;HTTP/Siren/事件/投影合同不变。
5. **业务优先原则的存续部分**:不为凑行数裁剪功能或证据的原则保留;"超限优先登记例外"的逃生门在 strict 接线(Phase F)后**退役**——此后超限的默认处置是变更时随改随拆解(见 FR4.3)。

## 功能需求

### FR1 文件级功能拆解(清零 7 条 GR3 文件基线)

| # | 文件 | 现值/限 | 拆解边界(沿功能) |
| --- | --- | --- | --- |
| FR1.1 | `apps/web/src/components/canvas/presentation-surface-host.tsx` | 642/500 | load 取数/装配编排提取为独立 hook 模块(基线 note 既定处置,随 D49-2 依赖注释批次);宿主收缩为装配+渲染 |
| FR1.2 | `apps/web/src/components/chat/floating-chat.test.tsx` | 944/800 | 按 feature 分片为多个测试文件 + 提炼共享 SSE 桩;用例只迁移不删除 |
| FR1.3 | `apps/web/src/app/api/chat/route.ts` | 949/500 | chat 编排(SSE 生命周期/流分段/错误分层)提取 orchestration helper 模块,route 收缩为路由壳 |
| FR1.4 | `apps/web/src/engine/service.ts` | 503/500 | getEntity/exec 的 flow 别名解析段提取并入 flow-entry 装配边界 |
| FR1.5 | `packages/agent/src/loop/loop.ts` | 520/500 | 反复拒绝机械收敛护栏(fail-guard 家族)提取为独立模块;循环终止判定保持单一可读 |
| FR1.6 | `scripts/t22/t22-helm-contract.test.ts` | 983/800 | 按部署关注点 describe 分片为多个测试文件 |
| FR1.7 | `scripts/t22/t22-compose-contract.test.ts` | 866/800 | 同上 |

每项完成后同步移除对应基线条目(check-size 对 stale 条目会失败,收缩与退役必须同 commit)。

### FR2 目录级领域分解(清零 5 条 GR3 目录基线)

| # | 目录 | 现值/限 | 分解方式(按域归档,非任意挪动) |
| --- | --- | --- | --- |
| FR2.1 | `packages/engine/src/presentation` | 4639/4000 | 直接文件按 compose/recipe/sidecar 子域归档(基线 note 既定处置);公共入口 `index.ts` 导出面不变 |
| FR2.2 | `apps/web/src/components` | 4184/4000 | chat 面板族等直接文件按 feature 归档子目录(基线 note 既定候选) |
| FR2.3 | `apps/web/src/db` | 4155/4000 | 随 FR3.1 `@ui4a/db` 抽包整体迁出退役;web 直接改引 `@ui4a/db`,不留 re-export 壳 |
| FR2.4 | `scripts/t22` | 14428/4000 | 按部署子域 compose/k8s/keycloak/backup 分目录;runbook(`docs/t22-production-runbook.md`)、`package.json`(`migrate:production`、`compose:t22`)、`deploy/compose/acceptance-contract.json` 等路径引用同步更新 |
| FR2.5 | `e2e` | 4628/4000 | 既有 spec 按业务域归档子目录(延续 T28 kits 模式);spec 内容不变 |

### FR3 GR1 依赖例外清退(清零 2 条 `dependencyExceptions`)

- **FR3.1 worker→web/db(27 文件引用,`pool`/`production-pool`/`events`/`migrations`/`agent-runs`)**:存储访问收敛为独立 `@ui4a/db` 工作区包(例外 `retireWhen` 既定路线):
  - 包内部按域组织(events/migrations/agent-runs/drafts/presence/presentation/pool 等),单一职责;
  - `scripts/governance/check-deps.mjs` 模块图扩展:`packages/db` 允许依赖 `packages/shared`;`apps/web`、`apps/worker` 增补允许依赖 `packages/db`;`shared`/`engine`/`agent` 维持禁止(平台纯净性);
  - vitest 工程(`--project db` 串行库测试)、tsconfig paths、workspace 依赖声明同步;
  - AGENTS.md 系统图与模块职责段同步(`apps/web/src/db` 段落迁移改写);"已知存储边界例外"表述随例外退役删除。
- **FR3.2 worker→web/engine(仅 `delegation.kill.integration.test.ts` 的 `getEngine`/`resetEngineForTests`)**:按 `retireWhen` 二选一并在 DECISIONS.md 记录裁定:
  - (a) 引擎组合根(service.ts 的 boot/exec/getEntity 装配)下沉为可复用的包内装配模块,web 与 kill 测试共用同一真身(优先取向:真正的功能拆解,与 FR1.4 收缩协同);
  - (b) 发布共享测试 harness 包。
  - 无论何种形态:消灭 app→app import;kill 测试仍走真 HTTP 合同 + 真 PG + 真 Temporal,证据链不降级。

### FR4 strict 接线与治理收口

- **FR4.1** `size-baseline.json` 清空(files/dirs 均空);`exceptions.json` `dependencyExceptions` 清空。GR2 `compatAllowlist` 8 条正当措辞原样保留。
- **FR4.2** `governance:strict` 并入 `pnpm check`(D52/GR4 触发条件"整个 size-baseline 清空"达成);`package.json` `check` 脚本接线。
- **FR4.3** DECISIONS.md 新增 **D53**:strict regime 生效后 GR3 超限处置从"登记例外"转为"变更时沿功能边界拆解";workflow.md 业务优先节对应修订(保留"不为凑行数裁剪/不删证据",退役"优先登记例外"逃生门);AGENTS.md GR3/GR4 措辞同步。
- **FR4.4** 全量验证(`pnpm check` 含 strict + `CI=true pnpm e2e`)、registry 归档、AGENTS.md/GOAL.md 如实反映终态。

## 非功能需求

- **零行为变化**:所有拆分后现有单测/集成/E2E 全绿;HTTP 状态码、Siren 投影、事件格式、重放哈希不变(DB replay 套件为证)。
- **依赖方向不回退**:新增包不进入 `shared←engine←agent` 纯净链;`packages/db` 是平台包,位于应用组合层。
- **可审计**:每项拆分独立 commit,git notes 记录拆分边界与验证证据;基线条目退役与代码收缩同 commit。

## 验收标准

1. `pnpm governance:strict` 全绿,且 `size-baseline.json` 为空对象结构、`dependencyExceptions` 为空数组。
2. `pnpm check`(已含 strict)全绿;`CI=true pnpm e2e` 全绿。
3. 全程未新增任何基线/例外登记(git 历史可审计)。
4. 测试用例总数不减(分片迁移除外);e2e spec 数量不减。
5. 每个拆出模块有单一职责与领域命名;无纯转发 re-export 壳;`apps/web/src/db` 目录不复存在。
6. `conductor/tracks.md` 归档本 track,DECISIONS.md D53 在案。

## 超出范围

- GR2 `compatAllowlist` 正当协议措辞(非债务,不动)。
- 业务功能、HTTP 合同、事件 schema 变更;无关文件的顺手重构。
- e2e/t22 验收证据裁剪; mothership 实机部署验证。
- `apps/agent-runner`(治理模块图中已登记,本 track 不触碰其依赖面)。
