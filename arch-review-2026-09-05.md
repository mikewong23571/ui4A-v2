# UI4A 代码库结构审查（架构视角，2026-09-05）

> **v2 修订（2026-09-05，经独立双重审核后重写）**：v1 经一个数据审计 agent（全量重算）与一个架构评审 agent（对照 AGENTS/DECISIONS/arch-brief 的对抗审查）复核。v1 的两处结论性错误已纠正：t22 探针文件是 **D52 已裁决的常驻保留物**而非 GR5 漏网（A06）；目录贴限压力**主要由测试行贡献**，非生产语义逼近（A03/A04）。数据快照锚定 `d980f797`（1727 提交，全部落在 2026-08/09；其后 conductor 文档与 D74 相关代码有少量漂移，个别行数 ±6）。
> **方法**：静态结构统计（文件数/原始行数/GR3 有效行数）+ 全历史 git churn（`git log --name-only` 文件触达次数）。**口径**：原始行含注释空行；有效行按 `scripts/governance/lib.mjs#effectiveLineCount`（非空非注释）；churn 含已搬移路径的历史触达，文中单独标注。v1 的合计 90,722 行误纳入 `.next-e2e*` 构建产物，已按 git 跟踪文件重算为 86,529。
> **标记**：🔴 结构性风险；🟡 职责/一致性缺陷；🔵 卫生类。编号 A01–A10、N1–N2；仅为记录，不构成已批准决定（改动需先过 DECISIONS.md）。

## 1. 总体结构画像

| 工作区 | 非测试文件 | 测试文件 | 非测试原始行 | 全历史 churn | churn 密度（触/千行，全触达/仅非测试） |
| --- | --- | --- | --- | --- | --- |
| apps/web | 291 | 288 | 35,961 | 2,979 | 83 / **46** |
| packages/engine | 94 | 80 | 18,592 | 838 | 45 / 27 |
| apps/worker | 74 | 43 | 11,669 | 339 | 29 / — |
| packages/agent | 37 | 42 | 6,617 | 392 | 59 / 33 |
| packages/shared | 30 | 17 | 5,538 | 199 | 36 / — |
| packages/db | 18 | 15 | 3,944 | 51 | 13 / **8** |
| apps/agent-runner（见 A05） | 10 | 6 | 2,246 | 71 | 32 / — |
| apps/cli | 17 | 9 | 1,952 | 73 | 37 / — |
| 合计 | 571 | 500 | 86,529 | 4,942 | 全部有效行（含测试）168,511 |

读取（经审核修正）：

- apps/packages 的文件触达中 **60.3%**（2,979/4,942）落在 apps/web，而其非测试行占 8 包合计的 41%。
- v1 用「全触达 ÷ 非测试行」得出 web 84 次/千行、独高 1.9 倍——分子含测试文件、分母不含，口径不一致。统一口径后 web 46 次/千行，是 agent（33）的 1.4 倍、engine（27）的 1.7 倍、db（8）的 5.9 倍：**方向不变，幅度收窄，web 不是唯一异常点而是边界包的正常偏高端**。web 内部触达约 45% 是测试文件。
- UI/HTTP/组装/投影/chat/auth 全部归属 web 是 AGENTS.md「Where a Change Belongs」的**刻意分派**，不是失衡本身；且 T36 已做过一次分压（db 抽包、engine 分组）。真正的残留问题收窄为 A02（service hub）与 A03（chat POST 单体）两个具体靶点。

## 2. 改动热点

### 2.1 文件级（现存路径；历史榜上的 `apps/web/src/db/events.ts` 31 次、`engine/src/fold.ts` 27、`agent/src/llm-driver.ts` 25、`engine/src/siren.ts` 23 均已搬移，且都低于前两名，排除不影响结论）

| churn | 文件 | 现状 |
| --- | --- | --- |
| 57 | `apps/web/src/app/api/chat/route.ts` | 440 有效行；POST 自 136 行起约 415 行单一 handler |
| 52 | `apps/web/src/engine/service.ts` | 491 有效行（D74 后 497）；已拆 10 个 `service-*` 模块后的装配枢纽 |
| 31 | `packages/engine/src/index.ts` | barrel（51 行），纯内核唯一出口 |
| 24 | `apps/web/src/components/canvas-body.tsx` | ⚠ 路径已迁至 `components/canvas/canvas-body.tsx`（新路径仅 5 次触达）——24 次属旧路径，是 T36 后 UI 重组痕迹 |
| 21 | `apps/web/src/components/action-runner.tsx` | 457 有效行 |
| 20 | `packages/engine/src/contract/siren/project.ts` | 459 有效行 |
| 20 | `apps/web/src/components/meta/renderers/common.tsx` | meta 渲染公共件 |
| 20 | `apps/web/src/components/entity-view.tsx` | 436 原始行 |
| 20 | `apps/web/src/components/canvas/presentation-surface-host.tsx` | surface 宿主 |
| 19–20 | `shared/src/index.ts` / walkthrough bundle / `exec`+`entity` route / `use-chat-session` 系列 | barrel / 应用数据 / 业务合同路由 |
| 18 | `apps/worker/src/workflows.ts`（483 有效行）/ `engine/effects` 旧路径 / chat route 测试 | worker 编排 |

barrel 型文件（engine index 31、shared index 19、agent index 17）churn 偏高：纯内核每加一个导出都要动同一文件，是「barrel 税」的耦合指示器（见 A02 末段）。

### 2.2 目录级（web 内部，全历史）

`components` 780 > `app` 720 > `engine` 627 > `render` 244 > `chat` 118 ≈ `auth` 118（`db` 旧路径 116 已迁走）。

- UI 层（components）是单一最大 churn 汇，超过 HTTP 层（app）与组装层（engine）。
- `conductor/` 流程文档全历史触达 2,251 次，约等于 web 代码的 75%（见 A10）。

## 3. 膨胀区块（GR3 有效行口径）

机械口径下**零违规**（0 文件超 500/800、0 目录超 4000，`size-baseline.json` 为空）——治理真实生效。但存在两群「贴限运行」区块。**经审核的关键修正：目录贴限主要是测试行贡献的**——`engine/src/definition` 3,979 中 72% 是测试、`execution` 57%、`src/chat` 58%、`app/api/chat` 77%。贴限 ≠ 生产语义膨胀；真正的生产侧压力集中在下表的文件级残余。

### 3.1 非测试文件贴 500 上限（≥440 有效行；apps/packages 内 14 个，全仓库含 scripts 共 18 个——v1 漏计 `scripts/t22` 4 个，其中 `t22-k8s-backup-restore-drill.ts` 498 行是全库最贴近限的文件）

| 有效行 | 文件 |
| --- | --- |
| 498 | `scripts/t22/recovery/t22-k8s-backup-restore-drill.ts`（D52 常驻债务） |
| 497 | `apps/web/src/components/canvas/use-presentation-surface-load.ts` |
| 497 | `packages/engine/src/presentation/surface/validate.ts` |
| 496 | `apps/web/src/components/chat/use-chat-session.ts` |
| 491 | `apps/web/src/engine/service.ts` |
| 490 | `apps/worker/src/runtime-backends/kubernetes/kubernetes-job.ts` |
| 488 | `packages/db/src/agent-runs.ts` |
| 483 | `apps/worker/src/workflows.ts` |
| 476 | `apps/web/src/auth/browser-session.ts` |
| 476 | `packages/agent/src/loop/loop.ts` |
| 470 | `packages/engine/src/agent-definition/parse.ts` |
| 459 | `packages/engine/src/contract/siren/project.ts` |
| 457 | `apps/web/src/components/action-runner.tsx` |
| 452 | `packages/engine/src/presentation/recipe/recipe.ts` |
| 440 | `apps/web/src/app/api/chat/route.ts` |

### 3.2 目录贴 4000 上限（有效行 ≥3500，机械计数 13 个；v1 报 11 个，漏 `scripts/t22/compose` 3,881 与 `web/src/engine/service-tests` 3,612）

`packages/engine/src/definition` **3,979（99.5%，其中测试 2,845/非测试 1,134）**、`apps/agent-runner/src` 3,938、`engine/src/execution` 3,935（测试 57%）、`scripts/t22/compose` 3,881、`web/components/meta` 3,879、`web/src/chat` 3,844（测试 58%）、`web/components/canvas` 3,831、`components` 根 3,740、`web/engine/drafts` 3,729、`web/engine/presentation` 3,707、`worker/src` 根 3,617、`web/engine/service-tests` 3,612、`web/app/api/chat` 3,524（测试 77%）。

## 4. 发现清单

### A01 🟡 apps/web 是最大边界包，但「60% churn」需按设计语境读

数字成立（60.3% 触达、46 次/千行为 agent 的 1.4 倍），且 UI/HTTP/组装归 web 是 AGENTS.md 的刻意分派、T36 已做过一次分压。**可操作的残留**不是「web 太大」，而是 web 内部两个具体耦合点（A02/A03）与 barrel 税。此条从 v1 的 🔴 降为 🟡。

### A02 🔴 `engine/service.ts`：拆完实现、没拆掉编排——且比 v1 认为的更严重

全库 #2 热点（52 次）。它已拆出 **10 个非测试 `service-*` 模块**，自身集中：`EngineRuntime` 接口（156–198 行，43 行签名）+ `getDb`/`getEngine` 装配 + re-export。v1 只说它是「枢纽税」；审核发现真正的病灶是 **`exec()` 闭包（约 339–573 行，~230 行）仍承载业务编排**：confirmation/thread/meta 路由、coding-result 预检、spawn-dispatch 准备、T52 `application-deprecated` 选择性 refold 特例都在 hub 里。hub 不只是装配点，还是业务分支点。两项前置约束：① 单原子串行队列是文档化不变量（AGENTS.md「裁决器即并发控制」、D34 跨副本原子性），拆 facade 不能移动原子点；② 存在 **type-only 环状依赖**：`service-confirmation.ts:29`、`service-thread.ts:12` 反向 `import type { ExecOutcome } from './service'`——hub 降权前须先把 `ExecOutcome` 下沉到叶子模块。`EngineRuntime` 扇入仅 8 个文件，接口本身拆分收益低；**真正的高价值目标是 `exec()` 闭包分解**。

### A03 🔴 chat 域：五目录分布是文档化设计，热点是那个「已登记、已延期」的 POST 单体

chat 域改动典型穿越 5 处（`src/chat` 域逻辑 1,616 非测试行、`app/api/chat` 816、`components/chat` 1,579 原始行、`engine/chat-situation|chat-thread|service-thread`、`app/chat` 页面）——这与 drafts 等所有域的分层方式一致，**是设计而非漂移**。`route.ts` 以 57 次触达居全库第一、单一 ~415 行 POST handler 也是事实，但 v1 漏了关键语境：**D40 曾将其登记入 size 基线，D52（2026-08-27）明确把收缩窗口「改挂在下一次 chat 编排重构」**；T36 已执行了部分（commit `ad550642` 提取 `request-body.ts`/`start-chain.ts`/`sse.ts` 三模块）；D68（T49，2026-09-04）显示 chat 仍在活跃决策治理中。结论：这不是新发现，是**已识别、已排期未执行**的最高价值重构位（候选 1）。

### A04 🟡 目录贴限的压力主要是测试行；v1 的「预写拆分缝」处方撤回

四个最贴限目录测试占比 57–77%（§3.2）。D53 已明文「拆分必须沿领域；禁止为凑指标的机械挪动/任意对半切」且列明「测试 describe 分片」是已执行的 T36 实践——濒限目录的合法泄压阀已存在。v1 候选 3（预写 DECISIONS 拆分缝）是重复且投机的，**撤回**，替换为：让 `check-size` 输出测试/非测试分列，使 4000 门禁的压力可解读（`definition` 的 99.5% 在分列视角下是「非测试 1,134/4,000」，并不紧急）。

### A05 🟡 AGENTS.md 系统图缺第四应用 agent-runner（文档单点漂移，非黑箱）

事实核：`apps/agent-runner`（10 非测试文件/3,938 有效行/依赖 `@openai/codex` 0.149.0/自带 Dockerfile）真实存在且 AGENTS.md 声明「三个可部署应用」；但 v1 的「不在任何架构叙述里」**错误**——D34（DECISIONS.md:396）点名新增 `apps/agent-runner`（同一 artifact 支持 K8s oneshot 与 trusted-host daemon），D36 裁定其拓扑，`DEPLOYMENT.local.md` 构建推送 runner 镜像，`release/v0.1.0-experimental.1/release-manifest.json` 固定 runner 镜像并含 `sbom/runner.spdx.json`。v1 称 docker-compose.images.yml 关联其部署链路亦不实（该文件无 runner 服务）。修正后的发现：**只有 AGENTS.md 的系统图滞后于 D34/D36**，属一段话可修的文档债。

### A06 🟡 t22 探针文件：v1 的 GR5 违背判定撤回，改为 D52 框架下的位置优化

事实核成立：`apps/worker/src/t22-temporal-probe-workflows.ts` 未注册进 worker 运行时，仅 `scripts/t22/t22-temporal-probe.ts` 经 `workflowsPath` 引用。但 v1 漏了裁定：**D52 已将该文件所在链路整体晋升为常驻部署合同套件，「路径与命名保留原样以免破坏上述引用」，且常驻合同测试 `scripts/t22/t22-probes-source.test.ts` 直接断言该文件内容**（确定性约束：禁 `node:`/`process.`/`fetch(`/`Date.`）。它是被治理的、被引用的、刻意放置的——不是漏网。残留的只是一个位置争议（可迁至 `scripts/t22/` 与唯一消费者同址，探针脚本的 `workflowsPath` 机制兼容迁移），**必须以 D52 修订案形式提出**，不能按 GR5 执法处理。v1 候选 5 的机械规则「归档 track 名不得出现在 apps/packages 源码路径」会误伤 D52 晋升的常驻门禁（`packages/agent/src/governance/t15/t16/t21-*.test.ts` 等），如要做需带晋升白名单。

### A07 🟡 同名概念多点分布：分层是设计，web 内部同名异义是真问题，且参考文档自身也在漂移

- **presentation** 横跨 6 个源码位置是 arch-brief §8.1 逐条声明的分层（类型→纯内核→web 规划适配→web 编译→agent 薄请求→HTTP）。真问题收窄为 web 内部 `engine/presentation`（规划/回执）与 `render/presentation`（A2UI 编译/水合）**同名异义**。
- 审核发现更便宜的第一步：**arch-brief §8.1 仍列着已迁至 `packages/db` 的 `apps/web/src/db/presentation`**——参考文档自身就是 doc-drift 实例，先修它再考虑源码改名（源码改名是纯 churn）。
- chat 5 处、meta 3 处维持 v1 记录（设计使然，认知成本真实存在）。

### A08 🔵 源码根部平铺文件偏多（计数已修正）

- `apps/worker/src/` 根部 **14** 个非测试平铺 `.ts`（v1 误 13），混生命周期/连接/编排核心/杂项/考古遗留（A06）。
- `apps/web/src/engine/` 根部 19 个非测试平铺文件 + 4 子目录 + 10 个 `service-*`，三种组织形态并存。
- `apps/web/src/components/` 根部 13 个文件含两大火件（`entity-view.tsx` 20 次、`action-runner.tsx` 21 次）；v1 把 `canvas-body.tsx` 计在根目录**错误**（已迁 `canvas/`）。AGENTS.md 对根部文件无规则，此条属卫生判断非违规。

### A09 🔵 大文件高注释密度——「文档化代码」而非垃圾

原始行最高的文件注释+空行占比 20–27%（`service.ts` 676→491、`use-chat-session.ts` 628→496、`workflows.ts` 612→483）。有效行才是健康指标；评估这些文件看职责宽度（A02/A03），不看原始行。

### A10 🔵 工作区卫生

- **4.2GB 构建产物**：`.next` 1.9G + `.next-e2e` 1.1G + `.next-e2e-root` 685M + `.next-t52probe` 263M + `.next-e2e-probe` 251M，全部 gitignore 但从不回收。注意 `.next-t52probe` 本身就是 track 命名遗留（与 A06 同型，但构建产物不在 GR5 字面管辖）。
- **conductor 体量**：21MB、280 md、52 归档 track、2,251 次文档触达（≈web 代码的 75%）。双产物同步成本真实存在；GR5「晋升或删除」在文档侧的执行弱于代码侧。

### N1 🟡（新发现，审核补充）GR2 扫描器只识别英文标记词，中文兼容措辞不可见

`scripts/governance/check-compat.mjs:18` 的 `MARKER_RE` 仅匹配 `legacy|backward-compat|compat…` 英文词形，而本库注释语言以中文为主。实例：`packages/shared/src/production-deployment-config.ts:2` 开头即「**兼容深路径入口**」——一个为 deploy/scripts 保留路径稳定性的 barrel 兼容层，扫描器不可见、allowlist 未登记。它可能是正当语义（有稳定引用方），但「GR2 allowlist 全部正当非债务」这一 v1 §5 结论因此打了折扣：allowlist 干净部分是因为扫描器看不见中文。最小修复：MARKER_RE 增加 `兼容`/`向后兼容`/`旧路径` 等中文词形（存量过 allowlist 登记）。

### N2 🟡（新发现，审核补充）GR1 只扫模块说明符，文件系统级反向耦合不可见

`check-deps.mjs` 基于 import 说明符，因此：`packages/agent/src/governance/t21-source-governance.test.ts` 以 `readFileSync` 读 `apps/web/src/...` 四个源文件；`t16-acceptance-matrix.test.ts` 依赖 `e2e/kits/t16-evidence`；`scripts/t22/t22-temporal-probe.ts:3-7` 直接 import `apps/worker/node_modules/...`（伸手进别的工作区的 node_modules 而非声明依赖）。均不违反 GR1 字面，但「GR1 例外 0」的认证范围比 v1 §5 暗示的窄。

## 5. 做得好的（经审核保留，N1/N2 打折处已标注）

1. 规模纪律真实有效：GR3 零超限零基线、GR1 依赖例外 0、GR4 strict 已常驻（D53）。——GR2/N1、GR1/N2 的认证范围有上述盲区。
2. 纯内核稳定：db 密度 8–13、engine 27–45，T36 重打包方向正确且已收敛；D53 建立的「膨胀即沿功能边界拆解」纪律有明文反机械切分条款。
3. 测试占比 500:571（web 近 1:1），且濒限目录的高测试占比说明验收证据随域共存。
4. 事件溯源单一真源无第二权威存储迹象。
5. **流程治理有牙齿**：本审查 v1 的两个最大误判（A06、A03 语境）都能在 DECISIONS.md 找到明文裁定——决策记录密度是本库的突出资产。

## 6. 候选改进方向（未批准；1/2/4 为审核后确认的优先项，均需先过 DECISIONS.md）

1. **chat POST 编排重构**（对应 A03；D52 已命名的收缩窗口）：`route.ts` 拆为鉴权/请求体/会话编排/SSE 四段，域逻辑继续沉到 `src/chat`——57 次触达的全库第一热点，且已有 D52 背书与 T36 三模块先例。
2. **service hub 降权**（对应 A02）：前提 = 保留单原子队列语义 + 先把 `ExecOutcome` 下沉叶叶模块解开 type 环；主目标不是拆 `EngineRuntime` 接口（扇入仅 8），而是**分解 `exec()` ~230 行业务编排闭包**。
3. ~~濒限目录预决策~~ **撤回**（对应 A04），替换为：`check-size` 增加测试/非测试分列输出。
4. **AGENTS.md 补第四应用**（对应 A05）：引用 D34/D36 一段话修正系统图（agent-runner 的部署链路在 DEPLOYMENT.local.md/release manifest，无需新叙述）。
5. **t22 探针文件迁移**（对应 A06，改述为 D52 修订案）：迁至 `scripts/t22/` 与唯一消费者同址；如做「归档 track 名不得入 apps/packages 源码路径」的机械检查，必须带 D52 式晋升白名单。
6. ~~presentation 目录改名~~ 降级（对应 A07）：先修 arch-brief §8.1 的 `apps/web/src/db/presentation` 陈旧路径；源码改名暂缓（纯 churn）。
7. **构建根收敛**（对应 A10）：e2e/probe 共享单一构建根或加回收脚本。
8. **（新，对应 N1/N2）治理盲区修补**：GR2 中文词形 + GR1 文件系统级读依赖的显式登记（或扫描扩展）。

---

### 附：v1 → v2 修订记录（2026-09-05 独立审核）

| 项 | v1 | v2 | 依据 |
| --- | --- | --- | --- |
| 合计非测试原始行 | 90,722 | 86,529 | v1 误含 `.next-e2e*` 构建产物 |
| churn 密度 | web 84 次/千行（🔴唯一异常） | 全触达 83 / 非测试 46（🟡偏高端） | v1 分子含测试分母不含；agent 33、engine 27 |
| A03 chat | 新发现的问题 | 已登记已延期（D40→D52），最高价值重构位 | DECISIONS.md:897-899 |
| A04 处方 | 预写拆分缝 DECISIONS | 撤回，改 check-size 分列 | 贴限目录 57–77% 是测试行；D53 已禁机械切分 |
| A05 agent-runner | 不在任何架构叙述里 | 仅 AGENTS.md 系统图滞后（D34/D36/DEPLOYMENT 均有） | DECISIONS.md:396 |
| A06 t22 探针 | 🔴 GR5 违背 | 🟡 D52 已裁决常驻；仅剩位置优化 | DECISIONS.md:889-893 |
| canvas-body.tsx | 现存路径、components 根 | 旧路径 24 次/新路径 5 次，已迁 canvas/ | 文件系统核验 |
| §3 计数 | 14 文件/11 目录 | 18/13（补 scripts/t22 与 service-tests） | 机械口径重算 |
| 其他计数 | 12 service-*、13 worker 根、EngineRuntime ~47 行 | 10、14、43 行（156–198） | 核验 |
| 新增 | — | N1（GR2 中文盲区）、N2（GR1 说明符盲区）、A02 type 环、arch-brief 陈旧路径 | 审核发现，均经本轮二次核验 |
