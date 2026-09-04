# T52 Application Deprecation:受治理的应用停用 — Spec

> 状态:new(2026-09-04,规划完成未开工)。方向由用户裁定:补齐应用停用路径,清理
> 验收走查残留;本 spec 按「先设计 review 后实施」纪律,经主工程师复审修订后定稿。
> D66 给了应用受治理的出生;本 track 补上对称的死亡。

## 1. 背景与问题

- 2026-09-04 部署站实况:11 个已安装应用,其中 `t48-prod-65a800`、`t51-prod-748704`
  为部署验收走查残留;**产品内没有任何 application 卸载/停用机制**(事件词汇仅有
  `application-seeded`,无反向动词;grep 零命中)。
- genesis 有「不得与已安装应用同名冲突」守卫 → 每次验收走查必须全新命名并**永久**
  装入 → 结构性累积,只会越来越多。
- 代码事实核查(2026-09-04,依据见 §6 复审记录)暴露四个必须显式处理的硬点:
  1. fold 无「移除键」先例;`applications` 键集即 app-known 不变式的已激活集合
     (`projection/fold/apply-seed.ts:61-64` 明言「表只经本事件增长」——本 track
     修订该口径)。
  2. **空受众 fail-open 陷阱**:`application:<name>` 归属为空数组时
     `reachableForGranted` 直接放行交三层裁决兜底(`auth/application-scope.ts:68-70`)
     ——若停用只做「从 map 移除」,`businessApplications` 对该 rel 返回 `[]`,
     受众谓词失管,**可能比停用前更可达**。
  3. **守卫双源不一致**:create/validate 查 snapshot(`applicationBundleInstalled`),
     activate 扫 log 的 `application-seeded`(`activate-application.ts:58-65`)——
     名字烧毁必须两处同时扩展,否则同名重建一半拦一半放。
  4. **`default` 真空**:无显式守卫;若停用 `default`,receipt 幂等会阻止重启
     bootstrap 重新 seed(`meta-bootstrap.ts:92-101` 对 log 判重),app-known 地板
     永久失守。

## 2. 目标(Goal)

**G1 受治理的死亡**:已安装应用的停用走产品内合同——`meta/application:<name>`
实体上声明的 `deprecate` 动作,human-only guard + `requires-confirmation: high`
两步确认,经既有 `/_meta/api/exec` 裁决,原子追加 `application-deprecated` 事件。
**不经 Draft**:与最接近的既有先例(definition `deprecate`,`definition/lifecycle.ts`
直连动作)同构;出生是对新内容的提案(D66 Draft),死亡是对既有事实的裁决(直连)。

**G2 全联动收缩**:停用确定性级联——应用退出 active map;其全部 flow 定义置
`deprecated`(app-known 不变式因此保持成立);capabilities 随活跃 flow 引用消失;
sitemap(分组+扁平 flows/surfaces/capabilities)、flow-entry 别名、发现文档、chat
发现链同步收缩;存量实例 existence-hidden(404)。**禁止任何 fail-open 残留可达**。

**G3 名字烧毁**:停用后的应用名在 log 级永久占用——create/validate/activate 三处
守卫对 `seeded ∪ deprecated` 名集 fail-closed 拒绝并留痕(I6)。

**G4 地板与边界**:`default` 不可停用(显式守卫拒绝留痕);其余应用(含 walkthrough
bundle 应用)均可停用——重启 bootstrap 因 receipt 幂等不会复活已停用的 bundle 应用
(已核证:`meta-bootstrap.ts` 判重对 log 事件,seded 事件与 receipt 永存)。

**G5 三门同门与授权收缩**:浏览器(实体页两步确认)/CLI(meta 写通道)同门;
agent 永不可触发;`authorizedPolicyScopes = Object.keys(applications)` 随事件收缩,
治理展开(D66.4)随之收缩,「我的授权」面板(T51)如实反映。

## 3. 设计决定(执行期先行落 DECISIONS.md 为 D71;本节即草案全文)

- **D71.1 载体与语义**:新核心事件 `application-deprecated`(detail: name/
  reason?/commandId;`reason` 为动作可选字段,提供即入 detail 留痕),由 engine
  meta 裁决路径在 action-executed 伴随追加(镜像 `definition-deprecated` 的
  `definition/meta.ts:288-299` 模式;**裁决分支落独立文件**,meta.ts 已 521 行,
  D53 膨胀即拆解)。fold 新 case:
  级联置废弃——`applications` 删除键、`deprecatedApplications` 记录审计集、
  全部 `definitions` 中 `app === name` 的条目置 `status:'deprecated'`。
- **D71.2 直连动作而非 Draft,以 application-lifecycle 伪流为宿主**:已否决
  替代方案一:draft 对称(D66 同型)——停用是对既有事实的裁决而非新内容提案,
  与「definitions are proposals」哲学不冲突(该口径约束新内容经提案入环;死亡
  是治理决定),且少动 8+ 处 kind 枚举面。**接线事实(第三轮复审查实)**:
  `executeMeta` 的动作声明与 guard 由注入 `executeWithGates` 的常量伪流承载
  (`DEFINITION_LIFECYCLE`,`meta.ts:246-249`);`meta/application:` 的
  `deprecate` 因此需要镜像的 `APPLICATION_LIFECYCLE` 伪流(声明 deprecate、
  guard actor-is-human、requires-confirmation high),同源喂实体投影的动作镜像
  (`meta.ts:238-240` 注释口径)。确认门走 executeWithGates 既有 confirmGate
  (P3 接线验证并测试)。已否决替代方案二:裁决层特判分支——绕过声明式裁决,
  违反「控件只来自当前 Siren 合同」(I3)。
- **D71.3 受众语义(反 fail-open)**:`businessApplications`/`metaApplications` 的
  归属解析扩展为「active ∪ deprecated 双集查询」——停用应用的任何 rel
  (application:/flow:/实例/surface)解析出**非空**归属(应用名本身,经
  `deprecatedApplications` 命中),使咽喉判「授予集合无交集」→ 结构化拒绝/
  存在性隐藏;禁止落入空受众 fail-open 放行。最终用户语义:停用面 = 存在性隐藏(404),与「从未安装」
  同形(D51 口径)。
- **D71.4 实例不阻塞**:与 definition deprecate 的 `no-live-instances` guard 不同,
  应用停用**不要求**零存活实例——停用即隐藏存量(测试应用常带测试数据,清理
  场景恰恰需要带数据停用);实例与事件在 log 中完整保留,重放可见。
- **D71.5 烧毁集**:`takenApplicationNames = seeded(log) ∪ deprecated(log)`。create/
  validate 的 snapshot 口径扩展为「active ∪ deprecated」;activate 的 log 口径把
  `application-deprecated` 同样计入已占用名(现状仅数 seeded,恰好仍拦,但语义
  要显式化并测试钉住)。
- **D71.6 default 守卫**:engine 裁决层显式拒绝 `target === 'default'`(guard 语义,
  拒绝留痕);理由:app-known 地板 + receipt 幂等会形成不可恢复真空(§1.4)。
- **D71.7 运维后果口径(凭证砖化)**:停用应用后,显式携带 `ui4a:policy:<app>` 的
  agent 凭证将**整体** 403(`delegation_scope_exceeded`:任一 scope 超出允许集即
  整凭证拒绝,`production/request-identity.ts:381-382`)——这是诚实失败而非部分
  降级,接受。运维合同:停用应用后同步轮换相关 CLI/agent 凭证的 applications
  配置并重新设备登录(DEPLOYMENT 联动)。
- **D71.8 flow 名烧毁级联**:停用级联置废的 flow 名同样进入烧毁集——
  flow-definition genesis/激活路径对「active ∪ deprecated」flow 名 fail-closed
  (数据源与口径在 P2 核实后钉测试),防止经 flow 提案复活已停用应用的面。

## 4. 非目标(Out of Scope)

- 不做应用「复活/重命名/归档分期」;烧毁即终局,复活另立决定。
- 不做实例数据清除(事件溯源不删历史;隐藏即达成清理目标)。
- 不做 per-app 授权治理(多租户授予仍按 D66.4 推迟到 IdP/多租户决定)。
- 不改 D66 出生路径与 T50 schema 注解机制(新动作自动进合同注解面)。
- 不新增 HTTP 路由/页面(edge 白名单零变化,无 T51-F1 类缺口)。

## 5. 验收(用户故事)

- **US1 裁决门**:`meta/application:<name>` 声明 `deprecate`(仅 active 应用;
  human-only;high 两步确认);执行走 `/_meta/api/exec`;agent 提交被引擎拒
  (I4 同口径);`default` 拒绝留痕。
- **US2 原子级联**:执行后伴随事件对(action-executed + application-deprecated)原子入 log;fold 级联(应用退场/flow 定义置废/capability
  消失);全 log 重放一致(I5);app-known 不变式保持;`assertMetaBootstrapIntegrity`
  不受影响;重启无复活(receipt 幂等)。
- **US3 全集收缩**:sitemap/flow-entry/发现文档/chat 发现链/`authorizedPolicyScopes`
  同步收缩;治理持有者授予集合收缩,「我的授权」面板如实反映;被停用应用的任何
  rel 呈现存在性隐藏,无 fail-open 可达(合同测试逐面断言)。
- **US4 名字烧毁**:停用名上 create/validate/activate 全部 fail-closed 留痕(I6)。
- **US5 存量隐藏与终态语义**:停用应用的实例读取 404、集合不含;`meta/application:
  <name>` 实体对所有主体存在性隐藏(受众非空但授权全集已收缩、无人再有交集);
  审计经事件日志/audit 面,不在实体面;`deprecatedApplications` 仅供受众与烧毁
  内部使用。并发双停用:动作仅声明于 active 应用,二次执行经 fresh-read 判
  stale-action(409)留痕。
- **US5b 已接受行为(记录)**:停用时在途的 capability/Temporal run 允许完成并
  写事件,其面随后隐藏;chat 线程本身 principal-owned 可读,指向停用实例的焦点
  引用优雅失效,线程不删。
- **US6 三门同门**:浏览器两步确认走查;CLI meta 写通道可执行并回读审计;
  合同/重放/invariants 测试族。
- **US7 部署站清理**:发布后用本机制停用 `t48-prod-65a800` 与 `t51-prod-748704`,
  应用目录回到 8 个产品应用(待用户发布裁定后走查)。

## 6. 设计复审记录(2026-09-04,定稿前完成)

已核证事实与据此修订(依据:只读代码核查,file:line 见 §1 与 plan 附录):

1. **fail-open 陷阱**(阻断级)→ D71.3 显式反 fail-open 受众语义 + US3 逐面断言。
2. **守卫双源不一致**(阻断级)→ D71.5 统一烧毁集口径,三处守卫同测。
3. **default 真空**(阻断级)→ D71.6 显式守卫;核证 receipt 判重对 log 事件,
   bundle 应用停用后重启不复活(G4)。
4. **app-known 级联**(高):flow 定义必须随应用置废,否则重放时 app-known
   不变式对孤立 flow 定义失败 → D71.1 级联置废;`activeFlowList` 现状不筛
   `definitions.status`(service.ts:260-265)→ P1 任务含该口径修订并全量回归。
5. **sitemap 扁平残留**(中):分组随 map 收缩但 flows/surfaces/capabilities 扁平
   表独立投影(sitemap.ts:265-427)→ US3 明确要求扁平面同步过滤。
6. **flow-entry/发现链残留**(中):flow-entry.ts 与 chat start-chain 不感知
   applications map → US3 纳入;sitemap 版本 bump 已含 applications 缓存键
   (service-sitemaps.ts:98-103)✓。
7. **先例对齐**(设计修订):definition deprecate 为直连 meta action 而非 Draft
   → D71.2 改为直连方案(原 T52 构想为 Draft kind,复审否决)。
8. **已核实无需担心**:bootstrap receipt 幂等对 log 判重;`assertMetaBootstrapIntegrity`
   只要求 receipt 可被 log seed 事件证明;`.applications` 全部消费者
   optional-chaining,移除键不炸(语义收缩即目标)。
9. **GR 风险预评**:fold/engine 纯层改动,无平台依赖(GR1);零新路由(GR2/edge
   无涉);涉及文件 fold/index.ts、apply-*.ts、meta.ts、sitemap.ts、
   business-applications.ts、create.ts、activate-application.ts 均在限内,变更时
   沿功能边界必要时拆解(GR3);未知 LogEventKind 会炸重放(fold/index.ts:306
   default: throw)→ 新 kind 必须与 db EventKind、effects EngineEvent 同步。
10. **遗留验证点(执行期首任务)**:CLI 是否已有 meta 实体动作执行通道(现
    `actions exec` 疑似仅业务面);若无,P4 增最小 `apps deprecate` 适配(合同同门,
    非 API 扩张)。

定稿前二次复审补充(2026-09-04):

11. **agent 凭证砖化**(高,已入 D71.7):停用应用的显式 per-app 凭证整体 403,
    运维后果必须写明而非留待发现。
12. **flow 名复活通道**(高,已入 D71.8):仅烧应用名不够——flow-definition
    genesis 可经新 flow 提案挂回已停用 app(app 字段指向已停用名),烧毁集必须
    级联 flow 名。
13. **GR3 实测**(中):`definition/meta.ts` 521 原始行(近/超限,按 effective
    lines 口径 P0 核实);新裁决分支一律独立文件(D53);`sitemap.ts` 427 行,
    扁平面过滤增量后注意余量。
14. **US7 计数口径**:停用两个走查残留后,已装 11→9,目录显示 9−1(default
    过滤)= 8 个,与「回到产品面」表述一致。

第三轮复审(定稿后,用户质询触发;全部已回写):

15. **接线宿主缺失**(阻断级,→D71.2):executeMeta 以常量伪流承载声明与 guard,
    `meta/application:` 动作无宿主——补 APPLICATION_LIFECYCLE 伪流设计;确认门
    confirmGate 支持列为 P3 验证项。
16. **自身措辞矛盾**:US2「单事件」与 D71.1「伴随事件对」不一致,已统一为事件对。
17. **停用后实体终态未指定**(高,→US5):明确存在性隐藏 + 事件日志审计,实体面
    不保留治理审计视图(如需另立决定,入非目标)。
18. **在途 run 与 chat 线程行为未记录**(中,→US5b)。
19. **并发双停用语义未钉**(中,→US5 fresh-read stale-action)。

## 7. 全景验收走查(终验)

本地 e2e:genesis 出生一个测试应用 → 写一条业务数据 → 停用(两步确认)→
断言:发现/目录/实体/集合/授予全集/授权面板全收缩、无 fail-open、重放一致、
同名重建被拒留痕。部署站(US7):停用两个走查残留应用,目录回到产品面。
