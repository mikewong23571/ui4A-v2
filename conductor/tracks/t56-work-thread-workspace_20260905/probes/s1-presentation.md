# T56 S1 探针报告:本线整体如何进入现有呈现链路(P0.2)

> 状态:**已执行**。执行时间 2026-09-06;基线 HEAD `c38883b074d30620008eeacbf4bfe5c5f864b1f5`
> (工作树另有编排 agent 的 plan.md [~] 与并行 S2/S3 窗口的文件,均非本任务改动)。
> 探针性质:只读验证 + 隔离 fixture,不改任何产品代码行为。全部实证可由
> `evidence.md` E-P0.2(由编排 agent 登记)与下文命令复现。

## 0. 结论速览

1. **选定首选路线(路线 A)**:以原 `thread:<id>` 作为公共认知根,在纯投影
   (`packages/engine/src/projection/work-thread.ts`)给 active/approval 补齐与 context
   同构的可授权成员卡与声明字段,复用既有单主体 Presentation
   host/generic/Recipe/Sidecar 链路。**无需新增 rel、无需第二套状态、无需硬编码应用页。**
2. 备选路线(derived Composition,`workspace:thread:<id>`)**机械上可行**(已实核),
   但引入第二认知主体、每次 present 的逐区域授权读放大(N+1)与成员变化的声明换版
   重规划,且区域内容仍由同一 generic 规划器逐实体产出——不减少路线 A 的任何工作。
   不作为主路线;D45 机器继续留给 app workspace。
3. 授权裁剪 machinery **已存在且逐引用生效**(properties.context/active/approval、
   links、entities、resume、goal.source 六处),路线 A 的角色读语义天然继承。
4. 探针发现的两个现状事实需要 P0.5 决策层面知悉:线程生命周期动作**不经确认门**
   (`requires-confirmation: 'high'` 标注在 thread 路径不生效);裁剪与真空在合同上
   **不可区分**,UI 文案必须用「当前可见」口径。

## 1. Fixture 与复现命令

- 隔离库:`docker exec ui4a-postgres psql -U ui4a -c 'CREATE DATABASE ui4a_s1_test'`;
  全程 `TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_s1_test`,未触碰
  `ui4a`(dev)与 `ui4a_test`。fixture 前缀 `t56s1-<runId>`(runId = randomUUID 前 8 位)。
- 测试文件:`apps/web/src/engine/service-tests/work-thread/presentation.test.ts`
  (service-tests 新子目录 `work-thread/`,独立 GR3 目录预算,不挤 3918/4000 的父目录)。

```bash
TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_s1_test \
  pnpm vitest run apps/web/src/engine/service-tests/work-thread/presentation.test.ts
# → Test Files 1 passed (1); Tests 6 passed (6); exit code 0
```

Fixture A 构成(全部经服务层 `engine.exec` 规范通道,断言于测试内):
open 线 + 目标「完成一项跨应用评审并记录决定」(goalSource 指向不可解析的 `chat:` 以覆盖
干净省略分支);context = `post:first-post`(publishing)+ `comment:c2`(community);
active = `software-change:main`(development,node implementation-ready);
approval = `confirmation:c1`(pending,target post:post-welcome)+
`confirmation:c2`(human 已 approve,target post:t56s1-second-post);
event = 指向本线 `thread-created` seq 的显式 `event:<seq>` 引用。
附带刻画:bundle 内唯一 high 确认动作是 `post-status@published:archive`;第二条
「已决定」确认经 article-drafting 向导 publish 产出第二篇 published 文章后获得。

## 2. exact Siren 现状(服务层等价读取,`engine.getEntity`)

测试用例 1 原样输出(`T56S1_EXACT_SIREN`),要点(路径均为 `packages/engine/src/projection/work-thread.ts` 的投影产物):

```jsonc
{
  "class": ["work-thread", "open"],
  "properties": {
    "rel": "thread:t56s1-a-…", "identity": "完成一项跨应用评审并记录决定",
    "id": "…", "owner": "user:t56s1-owner",
    "goal": { "text": "…", "source": "chat:t56s1-…" },
    "status": "open", "statusText": "进行中",
    "context": ["post:first-post", "comment:c2"],
    "resume": "停在「implementation-ready」",
    "active":   [{ "rel": "software-change:main", "status": "implementation-ready", "dangling": false }],
    "approval": [{ "rel": "confirmation:c1", "status": "pending",  "dangling": false },
                 { "rel": "confirmation:c2", "status": "approved", "dangling": false }],
    "recent-events": [1073],
    "presentation": { "fields": [            // 仅声明 3 个读字段;无 version/traits
      { "path": "properties.identity",  "title": "目标",       "role": "identity" },
      { "path": "properties.statusText","title": "状态",       "role": "status" },
      { "path": "properties.resume",    "title": "上次停在哪", "role": "primary-content" }] }
  },
  "actions": ["attach","detach","pause","complete","archive"],  // archived: [] 不变
  "links": ["self", ["context"]×2, ["active"], ["approval"]×2, ["event"]→/api/events?afterSeq=N-1],
  "entities": [ { "class": ["thread-reference"], "properties": { "rel": "post:first-post",
                  "identity": "第一篇", "status": "published" }, "actions": [], "links": ["self"] },
                { "class": ["thread-reference"], "properties": { "rel": "comment:c2",
                  "identity": "comment:c2", "status": "pending" }, "actions": [], "links": ["self"] } ]
}
```

**缺口(US01 的四个区域对照)**:

| 区域       | 现状                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| 目标/身份  | ✅ `identity`/`goal`/`goalSourceText`(不可解析时干净省略,已验证)                             |
| 生命周期   | ✅ `status`/`statusText`(任务语);归档动作组为空(既有事实,再验)                              |
| 当前责任   | ❌ approval 仅 `{rel,status,dangling}` 状态指针:**无可读标题、无目标身份、无动作组、无常显区** |
| 进行中工作 | ❌ active 同上;仅有 `resume` 一行派生文(取首个 active)                                        |
| 关联材料   | ✅ context 成员卡(`thread-reference`,身份解析自声明字段);`comment:c2` 身份回退裸 rel(诚实但糙) |
| 事件/审计  | ⚠️ `recent-events` + `[event]` 审计链接(只读到达,非呈现区域)                                  |

## 3. 授权裁剪现状(测试用例 2/3 实证)

裁剪单点在 `apps/web/src/auth/application-scope.ts` +
`apps/web/src/auth/audience/entity-projection.ts`(`filterEntityForGrantedApplications`,
经 sitemap `threads` 面 `scope:'principal' + memberRelPrefix:'thread:'`
声明式命中,`service-sitemaps.ts:143-150`):

- **少授予 development**(`['publishing','community']`):`properties.active` → `[]`;
  `resume` 派生行删除;`[active]` link 消失;context/approval 原样。无受限对象计数/名称/存在性泄露。
- **少授予 publishing**(`['community','development']`):`properties.approval` → `[]`
  (两个确认 target 均为 publishing 文章,归属经 `businessApplications` 继承);
  `post:first-post` 的 context 条目、link 与成员卡同时退场;active 保留。
- **跨 principal**:`getAuthorizedPresentationResult(rel, other, …)` →
  `subject-unavailable`(存在性隐藏);经 Broker `present` → `failed` receipt
  `reasonCode:'subject-unavailable'`(B1 分流)。HTTP 面为
  `assertThreadOwner`(`api/entity/route.ts:73`)→ 403 族(`scope_insufficient`,D73)。
- **结论**:路线 A 只在纯投影补成员卡/声明字段,授权裁剪零新增——成员卡作为
  `entities` 子实体天然吃同一 `readable` 谓词(已由 noPublishing 用例证明)。

### 附带发现(需 P0.5 知悉,本探针只刻画不修)

**线程生命周期动作不经确认门**:`apps/web/src/engine/exec/service-exec.ts:87-89` 把
`threads`/`thread:*` 直入 `execThreadAction`(`executeThreadCommand` 纯裁决),不进
`executeWithGates` 的 Cedar 确认门——`THREAD_ARCHIVE_ACTION` 的
`'requires-confirmation': 'high'` 标注在该路径**无效**(实测 agent archive 直通
accepted,零 confirmation 物化;测试用例 3 固化)。影响:工作线的「当前责任」只能来自
显式 approval 引用(业务确认),永远不来自线自身动作;FR6/US02 的责任到达全部走
`confirmation:*` 成员卡语义。

## 4. 呈现链路现状(测试用例 4/5 实证)

`focus=thread:<id>` → `/api/presentation`(subject=`thread:<id>`,intent,delivery)→
web Broker(`broker.ts`):`thread:*` 非 `workspace:` → 单主体路径;
`singleSubjectRecipeContext` → subjectShape=`entity`(`work-thread` class 无专用形状);
无应用 Recipe 命中(应用 Recipe 按 application/flow 场景生成;无 LLM 环境注册表为空)→
**plan → `planGenericSurface` → Sidecar(generic-fallback)**。实测 surface 树
(`T56S1_SURFACE`):

```text
identity←properties.identity(heading) · status←properties.statusText(state)
primary-content←properties.resume(prose) · actions(controls) · relation(references=links 词,
含 event 审计链) · repeat(member-link over entities=context 成员卡) + page-links
```

- **active/approval 无任何 surface 区域**(绑定路径扫描为零命中,断言固化);
  thread 投影无 versioned cognitive traits(`presentation` 无 `version`/`traits` 键)。
- **依赖方案**(`runtime.ts currentDependencies`,实测五条):
  `entity:thread:<id>`(invalidate;指纹 = contentVersion{class, presentation, actions,
  links})+ `catalog:semantic` + `definition:generic-intent-policy` +
  `policy:<授予集合排序 join>` + `members:thread:<id>`(**rehydrate**,指纹 = 成员 rel 序列)。
- **新鲜度实测**:
  - **值变化**(批准 pending 确认,properties.approval[i].status 变):链接/成员/动作不变 →
    指纹不变 → **同 Sidecar 命中**;渲染值由客户端 entity cache 经同源 `/api/entity`
    重读更新(binding-only,deref 从 `/api/entity` 取事实——`render/deref.ts` 头注)。
  - **成员变化**(attach):links + members 指纹变化 → invalidate → 重规划(Sidecar
    revise,version+1)。
  - **授权变化**(授予集合不同):durable 键不变(principal/subject/intent/device,D51)→
    同一 Sidecar 命中路径,但 entity 指纹(链接被裁)+ policy 指纹同时失效 → 重规划,
    新版本依赖含 `policy:publishing`(实测指纹逐条不等)。
  - **结论**:member/value/action/授权四类变化的 rehydrate/invalidate 接线**全部已存在**,
    路线 A 零新增失效机制。

### 认知 traits 覆盖对照(`packages/shared/src/definition/cognitive-semantics.ts`)

| 需求区域   | 现有词汇/机制                                               | 判定                         |
| ---------- | ----------------------------------------------------------- | ---------------------------- |
| 目标/身份  | presentation.fields role=identity;generic 身份回退           | ✅ 足够                      |
| 生命周期   | role=status;`statusText` 任务语                              | ✅ 足够                      |
| 当前责任   | trait `human-responsibility`、emptyMeaning `no-current-responsibility` 已在词表;**generic 规划器只消费 review-queue/output-catalog 两个 trait(genericMemberDensity),其余 trait 无规划通路** | ❌ 词表够、通路缺            |
| 进行中     | emptyMeaning `nothing-in-motion`/`ready-to-start`;resume 一行 | ⚠️ 缺成员卡/区域通路         |
| 材料       | member-link/member-card pattern + repeat                     | ✅ 足够                      |
| 产出/历史  | trait `output-catalog`/`task-history`、emptyMeaning `no-results` | ⚠️ 词表在,本轮非必需        |

## 5. 两条路线最小实现面对比(路线 B 已实核后删除探针代码)

**路线 A(选定)— 纯投影补角色读语义,单主体 Surface**:

- 改动面:`packages/engine/src/projection/work-thread.ts`(≈唯一必改产品文件)+
  `packages/engine/src/projection/work-thread.test.ts` 断言;可选
  `packages/shared/src/work-thread.ts`(如需类型)。**前端零改动**:`canvas-body.tsx`
  P2 移除 noGaze 旁路后,同一 `PresentationSurfaceHost` 直接消费。
- 声明形状:为 `active`/`approval` 引用生成与 context 同构的 `thread-reference` 成员卡
  (class `thread-reference`(+`dangling`);properties {rel, identity, status};identity
  复用 `resolvedReferenceLabel`——确认条目已有任务语「<targetAction> · 由 <actor> 提议」);
  approval 成员卡携带被引确认实体的声明动作(approve/reject)→ generic 规划器按纯结构判定
  (membersDeclareActions)自动选 **member-card**(D50 责任卡,ActionGroup/人机同权/
  fresh read 全继承);`presentation.fields` 补声明(如 `properties.activeCount` 类
  可重建计数字段仅在有授权来源时);`projectCognitiveSemantics` 形状给 thread 实体
  version:1 认知声明(traits/groupRole/emptyMeaning,复用现有封闭词表)。
- 授权:第三章已验证,零新增。第二应用接入:身份解析/成员卡/动作全部合同驱动,
  fixture H(未硬编码新应用)按同一通路成立——规划器零 class/rel 分支(generic.ts 头注纪律)。
- 同源 HTTP:所有展示事实 = `/api/presentation`(receipt/sidecar)+
  `/api/presentation/sidecar`(surface)+ `/api/entity`(subject 与成员 deref),已由
  宿主取数路径(`use-presentation-surface-load.ts:177-265`)与 deref 机制证明。
- 读放大:每次 present 服务端 1 次 subject 授权读;成员事实由客户端按需 deref。

**路线 B(备选,已否决为主路线)— derived Composition `workspace:thread:<id>`**:

- 已实核(临时 scratch 测试,跑完即删):仿 `app-workspace-composition.ts` 从线程
  snapshot 派生声明(thread 本体 + 每引用一 region),`planWorkspaceComposition` 产出
  三区域 surface;裁授权 region 落固定 `region-unavailable` diagnostic + `partial:true`
  (D45 逐区域重授权成立)。依赖 id 方案
  `composition:<id>@<version>:<region>:entity-contract` ×N + definition/catalog/policy。
- 否决理由:(1) 主体变为 `workspace:thread:<id>` 虚主体,与 FR1/US01「`focus=thread:T`
  进入本线」的 canonical 根冲突——保留原 rel 为主体则路线 A 的投影工作照样要做;
  (2) 每次 present 服务端逐区域授权读(N+1);(3) 成员变化 → 声明换版 →
  declarationFingerprint 全量重规划;(4) 区域内容仍由同一 generic 规划器逐实体产出,
  不省任何路线 A 工作。**失败判定检查:两条路线均不需要第二套状态或硬编码应用页,
  探针不判失败。**

## 6. 分组展示策略(空/终局/未知/授权裁剪;引用合同原词,不发明状态)

- **空**:按 `presentation.emptyMeaning` 封闭词表声明——无 active → `nothing-in-motion`;
  无责任 → `no-current-responsibility`;空线起步 → `ready-to-start`(threads 集合已用
  `ready-to-start`,T40 先例)。读失败/无权/真空三分(设计 §2),区域级 emptyMeaning
  需投影逐类别暴露(见 §7 扩展清单)。
- **终局**:`statusPointer.status` 原样携带合同状态(实例节点/确认 approved/rejected),
  展示即合同原词;归档线动作组为空 → 添加/移除不可提交(已有断言);归档仍有责任 →
  approval 成员卡与线程状态解耦(成员卡来自引用投影,已验证与线状态无关),不写
  「无需处理」。
- **未知/dangling**:`dangling: true` → link rel `[category,'dangling']` + 成员卡
  status=「对象不存在」(既有);status 缺失(artifacts/collections 类)→ 成员卡
  status 省略;不做状态词表外推断(US03 的未知状态不被硬编码误判)。
- **授权裁剪**:逐引用退场(已验证六处),口径=「当前可见/已关联」。**合同上裁剪与
  真空不可区分**(裁剪后 `active:[]` 与真空 `active:[]` 同形)——这是设计约束而非缺陷
  (有限授权不得泄露存在性),因此 UI 文案必须用「当前可见的关联工作/当前可见责任」,
  禁止「无进行中工作」全称量词;`resume` 被裁时该行消失,不加「不可见」占位
  (如需可辨,须新增可重建读字段并过 D51 审查——列入 P0.5 决策备选,不默认做)。

## 7. 语义扩展清单(最小必要;版本化认知声明落点)

**现有足够(零扩展)**:identity/status/primary-content/metadata 字段角色与预算
(`GENERIC_INTENT_POLICY v3`);member-link/member-card/member-table/page-links/
empty-state 词;[context]/[active]/[approval]/[event] rel 词表(含 dangling 限定);
`CognitiveSemanticsDeclarationV1` 全部封闭词表(traits/groupRole/priority/emptyMeaning);
授权裁剪六处;依赖/失效方案;确认任务语身份行。**无需新增 rel**——故无 parser/
discoverability/owner guard/客户端引用/递归组合验证负担。

**最小必要扩展(P1 实施项)**:

1. `work-thread.ts` 投影:active/approval 成员卡 + 声明字段补齐(纯投影,事件/写入模型
   零变化,可重建)。版本化落点:实体 `presentation` 经 `projectCognitiveSemantics`
   升级为 `version:1` 声明(traits/emptyMeaning + fields)——**认知声明单一落点**,
   渲染器只消费语义。
2. generic 规划器对非密度 trait 的消费通路(如按成员声明 groupRole 分组或责任区
   优先排布):沿 `packages/engine/src/presentation/surface/`+catalog 词表扩展,
   版本化 `PRESENTATION_SURFACE_CATALOG.version` + `generic-intent-policy` 版本递增,
   禁止 class/rel 分支。若 P1 以成员卡内声明行(presentations 绑定,T38 FR4 先例)
   表达分组,则此扩展可再缩。
3. 区域级 emptyMeaning 的投影暴露(逐类别声明,消费既有 empty-state 词)——词表零增。
4. (P0.5 备选决策,非默认)「被裁剪 vs 真空」可辨读字段:D51 审查后再议。

## 8. 探针代码去向(GR5)

- **保留**:`apps/web/src/engine/service-tests/work-thread/presentation.test.ts`
  (6 用例,常驻 db project;命名领域化非 track 化)。理由:即 P1.1 Red 种子——
  exact Siren/裁剪/呈现链/新鲜度四面的现状刻画带缺口锚定断言(active/approval 无成员卡、
  无 traits、无区域),P1.2 改投影时按新期望升级为 Red→Green;确认门旁路刻画
  (用例 3)是「现状事实」回归锚。运行命令见 §1。
- **已删除**:`route-b.scratch.test.ts`(路线 B 实核 scratch,输出已摘录于 §5,不留
  track 专用脚本);`/tmp/t56s1-exact-siren.json`(证据摘录已抄录本文件,临时文件不入库)。
- 治理:`pnpm governance` 全绿(check-size OK;新子目录 `service-tests/work-thread/`
  独立预算,父目录 3918 不变);eslint 0 error;`apps/web` typecheck 本文件
  0 error(并行 S2 探针文件的既有类型错误非本任务范围,未触碰)。

## 9. NOT RUN(本探针未验证项)

- 浏览器渲染断言(A2uiSurface 实际视觉、四区域最终观感)——属 P2/P4;本探针止于
  服务层 surface 树与 Siren。
- `pnpm check` 全量、`CI=true pnpm e2e`、真实 LLM 门禁、`pnpm --filter @ui4a/web build`
  ——非目标(任务纪律)。
- 路线 A 的**实施**(成员卡/traits 落码)——P1 才做,本报告只给形状与落点。
- S3 几何/会话存续、S2 历史引用——各自探针负责。
- 归档线的完整呈现用例(Fixture D/E 的部分组合)未在本 fixture 内展开;归档无动作与
  成员卡与线状态解耦两点已有断言/代码事实覆盖。

## 10. 工作树交接(本任务视角;git status 全列见任务报告)

本任务新增/改动仅两项:`probes/s1-presentation.md`(本文件)与
`apps/web/src/engine/service-tests/work-thread/presentation.test.ts`(P1.1 种子)。
并行窗口可见的 `apps/web/tsconfig.json` 修改(含 `.next-t56s3` include,JSON 重排版)、
`src/app/api/chat/history/s2-probe.test.ts` 等 S2/S3 文件、plan.md [~] 均非本任务产物,
未触碰。
