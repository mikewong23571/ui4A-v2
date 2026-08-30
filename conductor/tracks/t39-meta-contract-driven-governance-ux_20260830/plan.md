# T39 Meta 合同驱动治理与 Application 入口体验 — Plan

> 本文件在 Phase A 完成前是 **initial plan**。Phase B–H 均为 provisional；Phase A 的
> disposable spike 必须产出 architecture/DECISIONS/spec/plan 修订并由编排者依据 Product Vision、
> 自动化证据和架构不变量代行批准，批准前禁止进入生产实现。
>
> 固定评审项：Application 是图书馆、Work Thread 是书桌；无每 Application、每实体类型、
> 具体 rel/action 名展示分支；业务/Meta 定义只承载 Trait 与 Semantic Hint；设备密度、sticky、
> heading 和响应式属于 Presentation Plane；人类与 Agent 共用事实/关系/动作/认知语义，
> 不要求共用像素策略；Meta Renderer 零 LLM、零 Sidecar；不新增 per-track Playwright 配置。

## 编排与 Subagent 执行协议

### 每任务派发

- 每个实现/探针任务只派发给一个 subagent；任务依赖按计划顺序串行，不为并行而拆分。
- 编排者在派发前把该任务标记 `[~]`，生成自包含 prompt；subagent 不修改 `conductor/`、`DECISIONS.md`、Track 状态、commit 或 git notes。
- 每个 prompt 必须写明四要素：
  1. **Goal**：直接使用任务行的可验收结果，并包含最窄测试命令；
  2. **Non-goals**：使用对应 Phase 合同，明确不做下一任务、无关重构或新抽象；
  3. **Changes**：列出预期文件/模块和测试；
  4. **Blast radius**：列出允许与禁止触碰的目录。
- Prompt 同时包含 `GOAL.md`、`DECISIONS.md`、`product-vision.md`、本 Track spec/plan、相关 `AGENTS.md` 与 D53“膨胀即拆解、不裁剪功能、不登记例外”。

### 任务级轻验收

- subagent 负责 Red → Green、focused tests 和变更说明；只实现当前任务的最小闭环，不提前建设后续框架。
- 编排者亲自检查 diff，并只复跑 subagent 声称通过的 focused test/类型命令；不在每任务重复 `pnpm check`、全量 E2E 或全站视觉横扫。
- 任务通过后由编排者 commit、附 git note、记录 SHA 并推进下一任务；失败最多两轮修复，仍失败按 workflow 回滚该任务。

### Phase 与 Track 验收

- Phase Checkpoint 由编排者执行，不委派：复跑本 Phase 全部相关测试、`pnpm governance:strict`、必要 typecheck/`pnpm check`，并执行该 Phase 对应的浏览器/合同故事。
- Phase 验收只判断该切片是否完整可运行，不顺手修整其他 Phase；观察项进入 `review.md` 或后续任务。
- Track 结束由编排者按 US1–US19 做完整 E2E：人类 Renderer 浏览器路径 + CLI/HTTP 同门路径 + 390px + US19 真实 LLM 状态；此时才运行全量 `pnpm check`、`CI=true pnpm e2e` 和 invariants。
- 不因“以后可能需要”引入依赖、通用 DSL、基础设施或跨 Phase 抽象；只有当前故事与已出现的重复能证明时才抽取。

## Phase A：Disposable Spike、边界裁决与重新规划 [checkpoint: 4c531f2]

**Subagent contract（A1–A8）**：Goal=回答当前任务的一个不确定问题；Non-goals=不写生产实现、不定案下一 Phase；Changes=只读分析、focused probe/test 与临时 `mktemp` 工件；Blast radius=可读全仓，写入仅临时目录，禁止生产源码、`conductor/`、数据库与依赖变更。A9–A10 由编排者执行。

- [x] Task A1：盘点 definition、SitemapSurface、Siren entity、`presentation.fields`、Recipe/Sidecar、Meta Renderer registry、RJSF schema、Assistant disclosure 和 canonical/友好路由。ed0c447
- [x] Task A2：编写 disposable probe，比较 Trait/Semantic Hint 位于 definition、sitemap、exact projection 或 Presentation declaration 时的传播、缓存版本、Agent 可见性和依赖失效；Spike 不进入生产代码。0e4fe10
- [x] Task A3：验证 overview 复用 T38 `presentation.fields`，并证明业务定义无需 desktop/narrow density、sticky、heading source 或组件名。7a3e647
- [x] Task A4：验证 `human-authored`、`client-generated`、`server-owned` 字段归属；证明 Meta UI 可隐藏系统字段而 Agent/CLI 仍能稳定重试，且无需建设完整 Draft authoring 编辑器。cbe91cc
- [x] Task A5：核对 canonical `/meta/entity` 与 Flow/Activation/Capability 友好路由差异，形成一次性删除双路径的迁移清单。6e322c3
- [x] Task A6：验证 Application title/intent 的 binding-only 来源、entry/surface semantic roles、canonical 去重、collection 归属和用户 pin 边界；禁止用 `meta/application:*` 隐式跨站供数。df646da
- [x] Task A7：测量当前 sitemap/entity/prompt slice 字节基线，验证视觉策略不进入 Assistant prompt，披露仍是 scope → entity → actions 全量重建非累积。5d1271b
- [x] Task A8：产出 spike findings，明确采纳/否决项；允许结论否决当前 spec 中 Trait/Hint 位置或拆分 Track。b28ee52
- [x] Task A9：根据 spike 更新 `DECISIONS.md`、`architecture.md`、`spec.md` 与本 `plan.md`；保留一个 Track，并确立 Meta/Application 两个独立 milestone。4c531f2
- [x] Task A10：编排者审查并批准详细计划；Phase Verification & Checkpoint 确认 disposable code 已删除、文档与决定一致、系统零生产改动。4c531f2

## Phase B：Trait/Semantic Hint 纯合同与披露预算 [checkpoint: 4ba1a9b]

**Subagent contract**：Goal=建立最小语义合同与预算门；Non-goals=不改 Meta 页面、不修八个 Application、不增加视觉 DSL；Changes=`packages/shared/src/definition|presentation/`、`packages/engine/src/contract|presentation/`、Assistant disclosure 的最窄消费点及相邻测试；Blast radius=禁止 `apps/worker`、`packages/db`、Application bundles、`conductor/` 与新依赖。

- [x] Task B1：Red——用真实 articles/comments/meta entity、多 observation、UTF-8、trail 和 conversation 编写最终 provider request 32,768-byte 门禁测试，并确认失败。4c1062d
- [x] Task B2：Green——实现 current sanitized observation、旧完整 observation 替换、结构化 trail 和 fetch 前 runtime byte guard；公开 HTTP 不窄化。3f14454
- [x] Task B3：Red——编写 `CognitiveSemanticsV1` 派生优先、封闭词表、未知版本和视觉策略拒绝测试，并确认失败。7d2f199
- [x] Task B4：Green——实现最小认知语义 projector；复用 field presentation，不引入 generic presentation blob。c78d977
- [x] Task B5：Red——编写 sitemap/exact 双投影同源、hash/fingerprint invalidation、HTTP/CLI 可见与 Assistant allowlist 测试，并确认失败。4d51cdb
- [x] Task B6：Green——接入同一 pure projector 双投影和 scoped prompt sanitizer。afbf475
- [x] Task B7：Red——编写 `caller|client` input ownership、server-owned public params 拒绝、commandId/baseVersion 重试与 Agent/CLI parity 测试，并确认失败。49f422a
- [x] Task B8：Green——原子迁移 JSON Schema、RJSF、Agent tools、CLI、Siren 与 server validation；Draft create 从 trusted context 取 scope/schema。ed0c524
- [x] Task B9：Red——编写 Meta sitemap base surfaces 按 granted union 披露、lens 不改变授权并集测试，并确认失败。151ef91
- [x] Task B10：Green——修正 Meta sitemap 授予并集投影，不引入 route 级 scope 选择。dd63bc9
- [x] Task B11：增加低误报治理：禁止定义内 CSS/组件/设备策略、runtime per-app/per-rel 分支、server-owned public params 和视觉策略进 prompt；扫描排除合法 bundle 数据。b24fe76
- [x] Task B12：Phase Verification & Checkpoint：focused tests、typecheck、`pnpm governance:strict`、D51、真实 prompt budget 和公开合同完整性全绿。4ba1a9b

## Phase C：canonical Meta Renderer 单一真相 [checkpoint: ceb52cf]

**Subagent contract**：Goal=已知 Meta class 经 canonical 路径得到单一 Renderer；Non-goals=不改定义语义、Application landing 或业务动作；Changes=`apps/web/src/components/meta/`、`apps/web/src/app/meta/`、必要的 registry/client 测试；Blast radius=禁止 worker/db、业务 bundles、Presentation composition 与无关组件重构。

- [x] Task C1：Red——编写 canonical/旧 view/Situation 无 `publishing`/first-grant 默认 lens、缺 lens 一等态和授权并集不变测试，并确认失败。7187033
- [x] Task C2：Green——删除默认 lens 残留；URL 只保留显式 attention，服务端授权继续按 granted union。a87a9a3
- [x] Task C3：Red——编写 Flow/Activation/Capability canonical specialization、relationships/raw/actions parity 测试，并确认当前 generic 失败。ec01258
- [x] Task C4：Green——接入三类 specialization，canonical shell 唯一拥有 loading/cache/error/refresh。0a7ef21
- [x] Task C5：Red——编写全部 Meta links/presence bridge canonical、友好 route 零残留、写后 exact/collection/dashboard cache 同步测试，并确认失败。ffb4936
- [x] Task C6：Green——原子切换内链/bridge，删除七条旧 route、fetch wrappers 与 lists，并实现授权 Meta cache invalidation；不留兼容路径。1d940b3
- [x] Task C7：增加 registry completeness、ambiguity fail-closed 与旧 URL 源码/E2E 扫描。6093b05
- [x] Task C8：浏览器验证 US2、US4：canonical Flow/Activation/Capability、完整 topology/diff/checks、无默认 lens、返回路径连续。1612ad6
- [x] Task C9：Phase Verification & Checkpoint：focused tests、web typecheck、`pnpm check`、governance 和 Agent 合同探针。ceb52cf

## Phase D：任务优先 Meta 首页与声明式集合概览 [checkpoint: 1742bdb]

**Subagent contract**：Goal=让 Meta sitemap/summary 驱动首页与集合；Non-goals=不创建固定 surface 页面、不改 Application workspace；Changes=Meta sitemap adapter、dashboard、generic collection/overview 与相邻测试；Blast radius=禁止业务 Flow/事件语义、worker/db、Canvas composition、Chat 和新依赖。

- [x] Task D1：Red——编写 sitemap 责任/候选/定义/系统语义分组与未来 surface 自动进入测试，并确认失败。ad416ec
- [x] Task D2：Green——实现 Meta Dashboard 只消费语义分组、title、intent、overview 与计数，不维护固定 surface/status 清单。296eb0f
- [x] Task D3：Red——编写 collection overview、搜索总数、facet 声明和合同 links 分页测试，并确认失败。1d97eb7
- [x] Task D4：Green——复用 overview role，实现 collection 摘要与诚实截断；不把 table/card 响应式策略写回定义。38ee074
- [x] Task D5：浏览器验证 US1、US5、US8：责任点首屏、概览、未来 surface、桌面和 390px 通用策略。1742bdb
- [x] Task D6：Phase Verification & Checkpoint：无 surface 清单、无 per-app 分支、HTTP/CLI 可读同形认知语义。1742bdb

## Phase E：Draft 审查责任点与注意力语义 [checkpoint: 68f3757]

**Subagent contract**：Goal=收敛 Draft 人类审查与 lens 文案/连续性；Non-goals=不建设完整 Draft authoring、不重复 Phase B input ownership、不改 Draft 事件/审批语义；Changes=Draft Meta projection/renderer、Meta situation/client 与相邻测试；Blast radius=禁止 Agent authoring runtime、worker/db schema、Application bundles 与 Presentation composition。

- [x] Task E1：Red——编写 Meta UI 消费 Phase B ownership、不把 Create Draft/完整 payload authoring 提升为主路径的测试，并确认失败。f450e12
- [x] Task E2：Green——收敛 Draft collection/detail 首屏为 validation、diff、checks、sources、provenance 与当前 actions；advanced/raw ingress 退守下钻，不实现第二套 schema。f578847
- [x] Task E3：Red——编写 valid/invalid/stale Draft 审查、现场保留、返回 author/Assistant 修复和 human-only fresh-read decision 测试，并确认失败。f00ff75
- [x] Task E4：Green——实现通用 Draft 审查状态与责任点反馈，不生成专属修复表单。15d38b8
- [x] Task E5：Red——编写“当前视角”任务文案、URL 连续、授权集合只读说明和无 lens UI 状态测试，并确认失败。34bb95c
- [x] Task E6：Green——更新 lens 展示与审查现场恢复；运行时默认清理和授权并集语义复用 Phase C，不再实现第二处逻辑。bfa3d90
- [x] Task E7：浏览器验证 US3、US4、US9：审查而非 authoring、键盘、390px、stale/CAS 与 URL 连续性。68f3757
- [x] Task E8：Phase Verification & Checkpoint：D51、public schema、human-only、focused tests 与 governance 全绿。68f3757

## Phase F：责任点、关系与披露层级（Meta milestone） [checkpoint: c01206e]

**Subagent contract**：Goal=通用责任点、关系和三层披露；Non-goals=不按 action/class/rel 写专属页面、不改业务裁决；Changes=Meta common renderers、ActionRunner host adapter、link/raw disclosure 与相邻测试；Blast radius=禁止 engine judge/fold、worker/db、Application bundles 和 Chat。

- [x] Task F1：Red——编写 responsibility trait、任务/合同/raw 三层、`link.title` 与 `self` 退守测试，并确认失败。7a9b032
- [x] Task F2：Green——实现通用责任点和关系词汇；inline/sticky、heading 与窄屏姿态由 Presentation policy 决定。f20a440
- [x] Task F3：Red——编写 guard reason、两段确认、已决原位反馈、待决集合退出和 Dashboard/collection/exact 同步测试，并确认失败。d31091f
- [x] Task F4：Green——统一 ActionRunner/Meta host 反馈，提交前继续 fresh read，并复用 Phase C cache invalidation。3b55d15
- [x] Task F5：浏览器验证 US6、US7、US9：两次点击内决定、无需 raw、关系任务化、移动端不遮挡。c01206e
- [x] Task F6：Meta Milestone Verification & Checkpoint：US1–US10 可独立闭环，系统完整可运行；Application Phase 未开始也不影响 Meta 交付。c01206e

## Phase G：Application 图书馆与默认组合面（独立 milestone，provisional）

**Subagent contract**：Goal=用语义数据改善 Application 图书馆与组合；Non-goals=不把 Application 变成书桌、不改 `/` Work Thread 聚合、不写 per-app runtime 分支；Changes=Application/Sitemap 定义与投影、`app-workspace-composition`、Application 书架、通用 Presentation policy、bundle 数据和相邻测试；Blast radius=禁止 Meta governance Renderer、worker/db、Chat、每应用 React 页面与新依赖。

- [x] Task G1：Red——编写 `system-fallback`、结构化 entry `{target,role}`、same-app business entry、非法隐式 Meta/workspace entry 测试，并确认失败。4ab2ea7
- [x] Task G2：Green——实现 Application/Sitemap 最小语义与 parser/invariants；不加入 title/description/layout/device 字段。0b8601d
- [x] Task G3：Red——编写只读 `application:<name>` Siren projection、grantedApplications 授权、零 actions/events/storage 和 HTTP/Agent discovery 测试，并确认失败。47db991
- [x] Task G4：Green——实现 business Application projection 与 binding metadata，不读取 `meta/application:*`。865f007
- [x] Task G5：Red——编写 binding-only header、Application 不聚合 principal 工作状态、source alias 授权后 canonical entity/action 去重与完整 membership fingerprint 测试，并确认失败。7ac98de
- [x] Task G6：Green——扩展通用 `workspace:app:*` 组合，复用既有 Presentation 机器并保持 `/`/Work Thread 主角地位。68cfd47
- [x] Task G7：Red——编写 Flow `collections` 优先、append 次级、comments→community、多 owner 拒绝、extraSurface 不发明归属和字段闭合测试，并确认失败。c8c35c8
- [x] Task G8：Green——实现 collection ownership/field closure，不按集合名分支。3a776f2
- [x] Task G9：Red——编写 composition version 随内容变化、surface role→既有 exact intent、零 per-app intent 表测试，并确认失败。a5154bb
- [x] Task G10：Green——修复 composition version/fingerprint 与通用 intent policy，收回 app adapter 的视觉 density 决策。4a3c488
- [x] Task G11：Red——为 default/publishing/community/development/editorial/governance/todo/ideas 编写声明夹具与 US11–US17 失败断言。b432db6
- [x] Task G12：Green——修订 default/publishing/community 声明数据并复跑同一通用实现。5c564dc
- [x] Task G13：Green——修订 development/editorial/governance 声明数据并复跑同一通用实现。bef55f9
- [x] Task G14：Green——修订 todo/ideas 声明数据并复跑同一通用实现。6c59fdf
- [x] Task G15：Red——编写 Application 书架 discoverability/title/intent、声明顺序、当前 lens 轻强调、全员可达和 runtime 零 Application 名比较测试，并确认失败。64cbf34
- [x] Task G16：Green——实现书架消费；不新增 pin/recent/个人排序状态。73ce72e
- [x] Task G17：浏览器验证 US11–US18，逐 app 检查图书馆定位、title/intent、无重复动作、显式跨站、空态和 390px Presentation policy。6d2e2eb
- [ ] Task G18：Application Milestone Verification & Checkpoint：新增第九个 fixture 只改定义数据即可进入书架/landing；系统完整可运行且不破坏 Meta milestone。

## Phase H：Assistant 共同注视与全故事终审（provisional）

**Subagent contract（H1–H3）**：Goal=集成证明 Phase B 的 sanitizer 与同一 Situation/entity/action 消费；Non-goals=不新增第二套 disclosure、不新增意图启发式、不让视觉策略进 prompt、不用 rule driver 冒充验收；Changes=Assistant parity/FactRef/Eval 的最窄路径与测试；Blast radius=禁止业务引擎语义、Application 专属分支、worker/db 和新 provider。H4–H10 由编排者执行 Track 级验收。

- [ ] Task H1：集成测试——验证 publishing/community/governance 的 Situation → sanitized entity → actions、FactRef、clientView/lastNavigation 和视觉策略禁入 prompt；已有行为通过则不强造 Red。
- [ ] Task H2：仅在 H1 暴露真实缺口时做最小修复；否则记录 no-op 证据，禁止新增第二套 sanitizer 或全量 sitemap 注入。
- [ ] Task H3：运行 `pnpm eval:llm` 完成 US19 真实 LLM Eval；provider 缺失时记录未运行，禁止 scripted/rule 替代。
- [ ] Task H4：逐一执行 US1–US19 浏览器实操；记录前态、关键交互态、完成态截图和 DOM/URL/焦点断言。
- [ ] Task H5：使用 CLI 或 HTTP 合同探针复跑同门路径，比较事实、links、actions、guards、schema、Trait 与 Semantic Hint；不要求像素策略同消耗。
- [ ] Task H6：执行 390px 全流程视觉审核：Meta、Application 书架、八个 landing、Draft 审查、Activation decision 与错误恢复。
- [ ] Task H7：执行“换 Application”终审与源码扫描：第九个 fixture 零 runtime 特判，定义内无 CSS/设备策略，Assistant prompt 预算不增长越界。
- [ ] Task H8：运行 `pnpm format:check`、`pnpm governance:strict`、`pnpm check`、`CI=true pnpm e2e`、invariants 与 prompt budget。
- [ ] Task H9：汇总 `review.md`，逐故事给出 pass/pass-with-observations/fail、真实 LLM 状态、截图路径、DOM 事实和剩余观察。
- [ ] Task H10：Track Verification & Checkpoint：系统可运行、工作区无临时产物、Product Vision 门禁和 US1–US19 全部闭环。

## Phase: Review Fixes

- [x] Task: Apply review suggestions b5af5f7
