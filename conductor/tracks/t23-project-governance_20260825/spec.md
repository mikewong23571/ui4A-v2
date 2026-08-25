# T23 项目治理 — Specification

## 类型

Governance(工程治理,无业务功能)

## Overview

代码量评估(2026-08-25):git 跟踪有效行约 15.3 万,其中生产源码约 6.7 万、测试与
评估代码约 9 万。总量与 monorepo 平台范围基本匹配,但存在三类可机械识别的存量债务:

1. **兼容性代码**:项目尚未发布(`v0.1.0-experimental.1` 是首个试验性版本,仍在本
   Track 前推进中),代码库却保留了 T18 等历史 wire 兼容层与 legacy 路径。
2. **依赖方向漂移风险**:`shared ← engine ← agent`、apps 组合 packages 的方向目前
   主要靠 review 自觉,没有机械门禁;已存在一个口头承认的例外(worker 复用 web 的
   DB adapter)但未登记在案。
3. **超大文件/模块**:非测试源码有 30+ 个文件超过 500 有效行,最大 1647 行
   (`deploy/helm/ui4a/render.ts`);`scripts/` 按 track 编号堆积 15k 行考古层。

本 Track 先把治理规则固化为本文件第 GR1–GR5 节(规则先行,后续 Track 与日常开发
受其约束),再以类 TDD 的红绿循环清偿存量:每项规则先落一个会失败的机械检查并记录
基线(Red),再修复存量至通过(Green),最终全部并入 `pnpm check` 门禁。

## 治理规则(本 Track 的持久产出,Track 完成后迁入 AGENTS.md)

### GR1 模块依赖方向

允许的依赖方向(箭头 = "可依赖"):

```text
packages/shared ◄── packages/engine ◄── packages/agent
apps/{web,worker,cli,agent-runner} ──► packages/*
scripts/、e2e/、deploy/ ──► apps 与 packages 的公开契约
```

- packages 不得 import 任何 apps/*;apps 之间不得互相 import。
- packages 之间只允许上图方向,不得反向或横向成环。
- `packages/shared` 保持平台中立:禁止 db、Next.js、React、Temporal、网络代码。
- `packages/engine` 保持纯内核:禁止 PostgreSQL、HTTP、React、Temporal、环境访问。
- apps 内部跨边界(`app/` ↔ `engine/` ↔ `db/` ↔ `render/` ↔ `components/`)遵循
  AGENTS.md 的模块职责表;route handler 不直接写库,必须经 `engine/` 或 `db/` 边界。
- **例外必须登记**:所有违反上述方向的现存引用登记在
  `scripts/governance/exceptions.json`,每条例外含路径、原因、退役条件。Red 基线
  (2026-08-25)实测登记四条例外:worker→web `src/db` 存储复用(AGENTS.md 承认的
  存储边界例外)、worker→web `src/engine` 与 web→worker 两处测试期耦合、engine
  测试读取 web bundle fixture。Phase C 目标:收敛到仅剩存储边界一系,或更少。
  新增例外必须先改 exceptions.json 再写代码。

### GR2 不留兼容性代码(未发布窗口)

- 项目未发布,禁止为历史 wire 格式、旧事件 payload 版本、旧 API 行为保留
  legacy/compat 双路径代码。行为变更直接改唯一实现。
- 事件日志 schema 演进直接改;开发/测试数据库允许重置重放,不为此写迁移兼容层
  (生产备份恢复由 T22 合同覆盖,不属于"代码内兼容")。
- 本 Track 内存量清理清单(非穷尽,以检查脚本枚举为准):
  - `apps/worker/src/capabilities/coding/compatibility.ts` 及其测试(T18 wire 兼容);
  - `packages/engine/src/agent-run/legacy-capability-run.ts`;
  - `apps/web` 与 `apps/worker` 中标注 legacy/T18 兼容的 dispatch 与转换路径;
  - `apps/web/src/db/migrations.ts` 中为旧库结构服务的兼容 shim(显式迁移由 T22
    迁移合同取代)。
- 清理后代码中除例外登记外,不得出现以兼容旧行为为唯一目的的代码路径;检查脚本对
  `legacy|compat` 标记做存量扫描,只允许白名单注释语境(如引用历史文档)。

### GR3 文件与模块大小上限

以**有效行**(非空、非纯注释行)计量,检查脚本统一口径:

| 对象 | 硬上限 | 说明 |
| --- | --- | --- |
| 生产源码单文件(.ts/.tsx,非测试) | 500 行 | 超过必须拆分;新文件即刻适用 |
| 测试单文件(.test.ts/.spec.ts) | 800 行 | 超出按场景拆分为多文件 |
| 单一目录直属 .ts/.tsx 合计(不递归子目录) | 4000 行 | 约束单层平铺过多;超出按职责下沉或拆分 |
| 函数 | 不机械限定 | 由 review 与 ESLint 现有规则把关 |

- 存量超限文件登记在 `scripts/governance/size-baseline.json`,本 Track 内按影响面
  从大到小拆分清偿;Track 结束时 baseline 必须为空。
- 拆分只移动代码与归属,不改变行为;每次拆分后复跑该模块全部测试。

### GR4 治理门禁(类 TDD 执行方式)

- 每条规则对应 `scripts/governance/` 下一个独立检查脚本,纯 Node、无新依赖,
  输出违规清单而非仅退出码。
- 执行顺序固定为 Red → Green → Gate:
  1. Red:先写检查,确认它对当前存量失败,把违规清单固化为 baseline 文件提交;
  2. Green:修复存量,检查转绿;修复期间检查必须持续运行,不允许先删检查;
  3. Gate:全绿后把检查接入 `pnpm check`,从此违规即 CI 失败。
- baseline 文件只许缩短不许膨胀;PR 引入新违规必须当场修复或登记例外(GR1)。

### GR5 考古层控制

- `scripts/` 中 track 专属 eval/契约脚本(`t16-*`…`t22-*`),在所属 Track 关闭时
  要么提升为常驻门禁(移入 `scripts/governance/` 或包内测试),要么归档删除;
  不允许无限堆积。
- Playwright 配置按用途合并:常驻 CI 一套(invariants + 核心 spec),eval 类按需
  保留并标注触发方式;不为单个 Track 永久新增配置文件。
- 已完成 Track 的文档保持只读历史(conductor 既有约定),但其脚本不享有同等豁免。

## Functional Requirements

### FR1 治理检查套件

`scripts/governance/` 下至少提供:

- `check-deps.mjs`:扫描全部 ts/tsx import,验证 GR1 方向,消费
  `exceptions.json`;输出违规文件:行与期望方向。
- `check-compat.mjs`:按 GR2 扫描兼容性代码标记与已知遗留路径,白名单内嵌于
  exceptions.json 的 `compatAllowlist` 字段。
- `check-size.mjs`:按 GR3 统计有效行,消费 `size-baseline.json`;超上限且不在
  baseline 中即失败,baseline 中条目减少需同步更新文件。
- `exceptions.json` / `size-baseline.json`:例外与基线的唯一权威,schema 注释在
  文件头部说明。

### FR2 兼容性存量清理

按 GR2 清单移除 T18 wire 兼容层与 legacy 路径,同步删除其专用测试与 fixture;
被保留的新路径(agent 模型、canonical Agent Run)测试必须保持全绿。删除后
`git grep` 不得再存在以兼容为目的的分支。

### FR3 超大文件拆分

按 size-baseline 从大到小拆分,优先级(以 2026-08-25 测量为准):
`deploy/helm/ui4a/render.ts` 1647、`apps/web/src/db/agent-definitions.ts` 1192、
`packages/shared/src/production-deployment-config.ts` 1126、`e2e/story-eval-kit.ts`
1037、`apps/worker/src/agents/authoring/adapter.ts` 952、
`packages/engine/src/presentation/surface.ts` 950、`apps/web/src/engine/drafts.ts`
949、`apps/web/src/app/api/chat/route.ts` 895、`apps/worker/src/activities.ts` 840、
`apps/web/src/engine/service.ts` 828。拆分为纯移动,行为不变。

### FR4 门禁接入

`pnpm check` 增加 `governance` 步骤,串在 typecheck/lint 之后、vitest 之前;
`pnpm governance` 单独可跑。根 `package.json`、`AGENTS.md` 的 Build/Test 节、
`conductor/workflow.md` 的验收协议同步更新。

### FR5 历史 Track 归档

- 已完成的 Track(T1–T21)从 `conductor/tracks/` 移入
  `conductor/tracks/archive/`,目录内容保持只读不改写(conductor 既有约定:
  completed Track 文档是不可变实现历史)。
- `conductor/tracks.md` 重组:活跃 Track 一节只列 `[~]`;已完成 Track 保留
  单行标题 + archive 链接,或压缩为归档索引一节。
- `conductor/index.md` 及任何引用被移动 Track 路径的活跃文档同步修正链接。
- 归档只动位置不动内容;活跃 Track(T22 及之后)不归档。
- 与 GR5 衔接:被归档 Track 的专属脚本/spec 在同一 commit 序列中按
  "提升为常驻门禁或随 track 归档"裁决。

## Non-goals

- 不改变任何业务语义、HTTP/Siren 合同、事件日志格式语义、Temporal 合同。
- 不重写 `scripts/` 考古层的全部历史脚本——只执行 GR5 的"提升或归档"裁决,
  具体归档清单在 plan.md 任务中确定。
- 不引入新的重量级工具(dependency-cruiser、knip 等);检查用纯 Node 实现。
- 不处理测试覆盖率、性能、文档完整度等其他质量维度。
- 不阻塞 T22 的发布目标;若清理与 T22 在途工作冲突,以 T22 文件锁为准排队。

## Acceptance

- `pnpm governance` 全绿,且已并入 `pnpm check`。
- `exceptions.json` 的依赖例外收敛到 worker→web `src/db` 存储边界一系(或更少);
  compatAllowlist 中无 pendingRemoval 条目。
- `size-baseline.json` 为空;GR2 兼容清理清单全部完成并有删除 commit。
- `pnpm check` 与 `CI=true pnpm e2e invariants` 全绿,证明清理无行为回归。
- AGENTS.md 迁入 GR1–GR5 规则,workflow.md 记录门禁验收点。
- T1–T21 已归档至 `conductor/tracks/archive/`,`tracks.md` 活跃区只含在途 Track,
  归档链接全部可达。
