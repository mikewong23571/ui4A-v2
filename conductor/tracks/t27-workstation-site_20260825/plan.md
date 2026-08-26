# T27 Workstation 站点 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> spec:`./spec.md`(含方向依据、依赖锚点、现状事实与 Phase A 决策点;实施前以仓库现状复核)。
> TDD 顺序:每 Task 先 Red 再 Green;每 Phase 结束复跑 `pnpm check` 与
> `CI=true pnpm e2e invariants`。
> Phase B–F 固定执行 D46(Phase A 产出);不得重新引入已否决形态。
> 治理纪律:GR3 行数上限不驱动裁剪(业务优先原则);components 目录重组按基线
> note 预留窗口(canvas/why/sidecar feature 子目录)执行;例外登记由编排 agent
> 统一执行,subagent 只如实报告。
> 前置确认:T30 已闭环归档(组合机器与 my-work 声明是本 Track 的承载机)。
> 实施前必读:根 `AGENTS.md`(构建/测试命令与 GR1–GR5 治理门禁)、
> `apps/web/AGENTS.md`(Next.js 版本特定规则,改 apps/web 前必读)、
> `conductor/workflow.md`(任务生命周期/验收协议/Phase Checkpoint)。

## Phase A: Spike → DECISIONS(分歧先于代码) [checkpoint: b1985b8]

- [x] Task: spike 五问决断,落 DECISIONS.md D46 `952574e`
  - 五问 = spec.md"Phase A 决策投影":首页落地形态、处境常显与显式声明形态、
    站点命名与 presence site 值域、导航折叠形态、跨站桥推导规则
  - 每问记录评估选项、约束、采纳项与否决理由;锚点:spec.md"现状事实"节;
    可用纯函数/组件原型验证形态语义(不提交或提交为 spike 测试)
  - 验收:DECISIONS.md 新增条目,编号顺延(当前最新 D45);五问各有明确
    采纳/否决;否决项写明理由(防复辟)
- [x] Task: spec/plan 回改对齐 D46 `d5b227a`
  - 将 D46 已决形状同步进 spec 最终形态与 Phase B–F 任务合同,移除未决选择
    口径;tracks.md 无需动(本 Track 已登记)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) `b1985b8`

## Phase B: 误导验收前置迁移 [checkpoint: 5cbf49e]

> 先于新首页与新导航落地——保绿即冻结旧首页 = 方向错误。本 Phase 是纠偏原则
> 的执行,不是测试补强。

- [x] Task: e2e 首页锚点迁移 `21ba95c`
  - 按 spec"误导性验收排查"清单逐条处置 `e2e/human.spec.ts`(:52-53/:56/:84/
    :116/:149-150)、`e2e/dual-executor.spec.ts`(:157/:175/:207)、
    `e2e/s1.spec.ts:391-419`、`e2e/smoke.spec.ts:8-9`:改为断言合同承诺
    (存在性/可导航)或删除;处置记录进任务 notes
  - 零件页导航锚点(human :160/:169、dual-executor :240/:247、
    s3.spec.ts:467-553)本 Phase 不动,仅登记;入口文案变化时随 Phase C 同步
- [x] Task: home.test.tsx 整文件重写 + fuzz 选择器预案 `6eebfeb`
  - `apps/web/src/app/home.test.tsx`(384 行)整文件重写:从"钉死旧六区块"
    改为已决首页合同断言:独立 `/` 门、固定 `workspace:my-work` 请求、共享
    Sidecar 单树宿主链与壳元素存在;"纯导航页零可提交元素"(:306-324)迁移为
    所有可提交控件均经 action gate 的口径
  - `e2e/i3.spec.ts:31-47` PAGES 表与 `e2e/invariants.spec.ts:363-372` 的
    首页 ready 选择器先改为独立 `/` 壳稳定锚点,Phase D 改为共享单树宿主
    ready 锚点并复核零白名单 fuzz
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) `5cbf49e`

## Phase C: 站点壳与三形态导航

- [x] Task: presence site 值域一次性切换(D46 第 3 问) `505243a`
  - Red:站点推导/装配/起点链的 site 值断言(`workstation`/`meta`)
  - Green:`/meta` 前缀推导 `meta`,其余路径推导 `workstation`;同步迁移
    `presence/client.ts`、`chat-situation.ts` defaults、`start-chain.ts` 站点
    兜底与相关测试;删除 `business` site 口径,raw 不进入值域,GR2 零双路径
- [x] Task: 导航重组与系统区(D46 第 4 问) `f1e44ae`
  - SiteNav 按 workstation/meta 分区;“我的事”(`/`)与“共同注视”(`/canvas`)
    是 workstation 顶级入口,meta 是显式越界入口;收件箱、事件流、委托监控
    折叠为壳级“系统”区,路由全部保留;raw 无顶级入口
  - Red→Green:导航结构组件测试(站点分组/系统区入口可达/全部新控件
    data-nav 注记齐全);导航文案任务语言
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 首页"我的事"落地

- [ ] Task: 共享 canvas 宿主提炼(D46 第 1 问)
  - 从 `canvas-body.tsx` 提炼 sidecar 单树宿主为共享组件(取数链
    `POST /api/presentation` → `GET /api/presentation/sidecar` → hydrate →
    action gate → 单树渲染);`/canvas` 与 `/` 共用同一宿主,零渲染链分叉;
    按 components 基线 note 的 canvas/why/sidecar feature 子目录方向落位
  - Red→Green:同一宿主两种挂载(canvas 参数形态 / 首页固定
    `workspace:my-work`)行为一致的组件测试;`/` 不重定向,不存在第二套
    presentation fetch/hydrate/action-gate 实现
- [ ] Task: 首页落地与 home-body 退役
  - `/` = 壳 + 宿主渲染 `workspace:my-work`;`home-body.tsx` 删除;运行概览/
    文章/收件箱/评论队列/委托监控/定义管理六区块不移植
  - Red→Green:首页三区块来自 my-work 声明区域源(断言取数 subject 与区域
    源,不钉树形状);零每区块特判自查;why 抽屉区域清单在首页同样可达
- [ ] Task: 首页 e2e 与 CLI 对照
  - e2e:首页三区块内容 vs 合同读 `inbox`/`delegations`/`threads` 逐项一致
    (CLI 或等价 HTTP 合同读;人机同源证明)。CLI = `apps/cli` 产出的 `ui4a`
    binary,用法参照 `.agents/skills/ui4a-cli/SKILL.md`
  - Playwright 走查截图:首屏零机制词汇、三门问题一眼可答
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: 处境常显、显式声明与双桥

- [ ] Task: scope/处境常显组件(D46 第 2 问)
  - 壳级常显固定为 site/scope/thread/focus,直接回显
    `presenceObservationForLocation` 的当前 URL observation,并标明它是声明的
    处境而非授权结果;不展示 granted scopes、不新增 GET situation 端点、不在
    浏览器调用 `assembleSituation`
  - scope、进线、出线与跨站均为 URL 导航;`thread:<id>` 目标链接携带
    `?thread=<id>`,出线删除 `thread` 参数,不增加“设为当前工作线”控件
  - Red→Green:常显与 PresenceReporter/clientView v2 同源断言;上述导航产生
    对应 presence 事件落库(组件 + API 级或 e2e),零自然语言启发式
- [ ] Task: 跨站双桥(D46 第 5 问)
  - 仅对 `flow:<name>` ↔ `meta/flow:<name>` 做双向机械推导:
    workstation 链接为 `/meta/flow/<name>?scope=<scope>`,meta 链接为
    `/canvas?focus=flow:<name>&scope=<scope>`;零映射表、零 React 实体类型分支
  - 零实例或多实例沿用 `resolveFlowRelAlias` 的诚实 404,其他实体不显示桥;
    两座桥在 T27 同时交付,不修改 meta 治理视图内部
  - e2e 双桥走查:首页 → 工作线 → 注视 flow → meta 编辑(保 scope)→ 查看
    活实例 → 回 workstation
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase F: 端到端验收与收尾

- [ ] Task: 全量验收
  - `pnpm check` 全绿;`CI=true pnpm e2e invariants` 全绿;`CI=true pnpm e2e`
    全量全绿;T16 presentation 套件、T24 honesty 套件、chat 套件全绿;这些
    本地命令只作为开发门禁,不作为 Track 最终现场验收证据
  - 从完成 T27 的确定 Git SHA 构建 Web/Worker/Runner OCI images,记录 archive
    checksum 与 immutable digest;按 `docs/t22-production-runbook.md` 和 mothership
    overlay 将同一组 digest 导入目标节点并执行受审 Helm upgrade,禁止 mutable
    tag 漂移、`--force`、删除 PVC/PV/Secret 或绕过 Istio/OIDC
  - 在 `https://ui4a.mothership.internal:32067` 现场验收 T27 DoD:workstation/meta/
    raw 形态、我的事三区域与合同对拍、处境声明与 presence 留痕、双桥、I3/I5/I7
    不变量;记录 Git SHA、image digests、mothership-setup SHA、Helm revision、命令、
    时间与结果到本 Track evidence。最终结论只依据该部署环境,不以本地
    `pnpm dev:all` 代替
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;track 目录按 GR5 处置(无 bespoke 脚本/
    配置残留);metadata.json 归档;components 目录基线按实际收缩更新
    (兑现 note 预留窗口,或登记新基线并注明处置计划);T28 spec 的站点框架
    口径如有偏差回改一行备注

## 验收标准(Track DoD)

1. spike 五问落 DECISIONS.md(D46,采纳与否决齐全),spec/plan 与之一致;
2. 三形态路由坐实:workstation = `/`、meta = `/meta`、raw 无顶级入口;零件表
   折叠为系统区,路由全保留;presence site 值域一次性切换,零双路径;
3. 首页 = 壳 + 共享宿主渲染 `workspace:my-work`,三区块全部来自声明区域源;
   零每区块/每实体类型/每应用特判;home-body 硬编码退役;
4. scope 常显在场,进线/出线/跨站/切 scope 显式且 presence 留痕,chat 上下文
   经 clientView 同源消费;
5. 双桥可达、保 scope、零映射表;
6. CLI 对照三类事实逐项一致;`pnpm check` + `CI=true pnpm e2e invariants` +
   e2e 全量全绿;从确定 SHA 构建的 immutable images 已部署至 mothership,并在
   现场环境完成 DoD 验收与可审计 evidence,系统实际可运行。
