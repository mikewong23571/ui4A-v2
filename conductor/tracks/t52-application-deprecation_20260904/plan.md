# T52 Application Deprecation — Plan

> 状态:规划完成,**未开工**(用户裁定:先 track + 设计 review,不立即执行)。
> 执行纪律:严格 TDD(先红后绿);每任务完成即 commit + git note;Phase 结束跑
> Phase Checkpoint(自治验收);GR1–GR5 全程生效。spec §6 已含设计复审记录,
> 执行期发现新事实按 workflow「Task Correction」回写 plan 并注明。

## Phase 0 — 决定与开工核对 [checkpoint: 82565b22]

- [x] Task: DECISIONS.md 落盘 D71(spec §3 全文:载体与级联/直连动作/反 fail-open
  受众/实例不阻塞/烧毁集/default 守卫) `9394b2b9`
- [x] Task: 开工前事实复核(代码可能已漂移):复核 spec §1/§6 引用的 file:line
  仍成立;CLI meta 动作通道现状(spec §6.10)定 P4 任务形态;GR3 行数口径核对
  (`definition/meta.ts` 521 原始行——新裁决分支落独立文件
  `definition/application-deprecation.ts`,D53;`sitemap.ts` 427 行余量评估) `82565b22`
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `82565b22`

## Phase 1 — 事件与 fold 级联(engine 纯层) [checkpoint: 9beeace7]

- [x] Task: 事件词汇三处同步(packages/db EventKind、engine LogEventKind、
  effects EngineEvent)+ fold `application-deprecated` case(fold/index default:
  throw 纪律:先加测试钉住未知 kind 炸,再同步加 case) `9beeace7`
- [x] Task: 级联 fold(测试先行):applications 删键 + deprecatedApplications 审计集
  + 同 app 全部 definitions 置 status:'deprecated';幂等重放;I5 全 log 重放一致;
  app-known 不变式保持 `9beeace7`
  (两任务同文件同测试簇,合一提交;confirmation.ts 携带缺口记 P3)
- [x] Task: `activeFlowList` 口径修订(现不筛 definitions.status,service.ts:260-265)
  ——废弃 flow 定义退出活跃注册表;全量回归钉住无意外收缩 `8ed551b8`
  (全量回归移至 Phase checkpoint 统一执行,并行改动在途)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `9beeace7`

## Phase 2 — 守卫与烧毁 [checkpoint: 036dd46f]

- [x] Task: 烧毁集统一(create/validate snapshot 口径扩为 active ∪ deprecated;
  activate log 口径显式计入 application-deprecated;三处同测,D71.5) `036dd46f`
- [x] Task: flow 名烧毁级联(D71.8):停用应用的 flow 名在 flow-definition
  genesis/激活路径 fail-closed;核实 activate-flow 目标检查数据源(snapshot/log)
  后钉测试 `036dd46f`
  (数据源=definitions 键集,deprecated 键保留天然 fail-closed,纯钉测试;
  顺带修复 audit-only 烧毁名 approve 安装洞)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `036dd46f`

> 顺序修订(2026-09-04 执行期):原「default 守卫」任务移入 Phase 3——guard 语义
> (拒绝 target==='default')的宿主是 APPLICATION_LIFECYCLE 伪流声明,P2 单独实现
> 是无宿主悬空守卫;随 P3 伪流一并落地并同测。

## Phase 3 — 裁决路径与全联动收缩 [checkpoint: 1bd95f07]

- [x] Task: APPLICATION_LIFECYCLE 伪流(镜像 DEFINITION_LIFECYCLE:声明 deprecate、
  guard actor-is-human、requires-confirmation high)注入 executeMeta flows 映射 +
  实体投影动作镜像 + 伴随事件对(action-executed + application-deprecated;独立
  文件 application-deprecation.ts);confirmGate 对 high 动作接线验证(第三轮复审 15);
  default 地板守卫(D71.6,自 P2 移入:guard 拒绝 target==='default',拒绝留痕 I6) `47f3edc1`
  (确认门核实:默认策略 human+high 直通,high 为 UI/策略标注,approve/reject 先例同构)
- [x] Task: 并发双停用 stale-action 留痕测试(US5;fresh-read 口径) `47f3edc1`
  (已停用实体二次 deprecate → undeclared 未声明于节点 deprecated)
- [x] Task: 受众反 fail-open(businessApplications/metaApplications 归属解析扩为
  active ∪ deprecated 双集查询(D71.3),停用应用 rel 解析非空归属→无交集即拒)
  + 逐面合同测试(application:/flow:/实例/surface) `954db2b5`
  (逐面覆盖矩阵见 git note;P3b 锚抓出并推动修正 P3a 投影语义)
- [x] Task: sitemap 扁平面过滤(flows/surfaces/capabilities 随 active map 收缩)+
  flow-entry 别名 + chat 发现链/recipes 收缩;治理展开收缩 + 「我的授权」面板
  反映(T51 联动断言) `1bd95f07`
  (核实:deriveSitemap 参数驱动,service 链路经 activeFlowList 已收缩,零引擎改动
  + 引擎级钉测;flow-entry 补 isDeprecatedFlowName 守卫;chat/membership 自动跟随钉测;
  授权收缩经 P3b auth/session 钉测 + 面板读该 API,T51 面板测试自动覆盖)
- [x] Task: 存量实例 existence-hidden(读取 404、集合不含;事件留痕可审计;US5) `1bd95f07`
  (读取面受众层 P3b 954db2b5 钉 403/404;别名/集合/补全面本提交收缩;联合覆盖)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `1bd95f07`

## Phase 4 — 同门与验收

- [x] Task: 浏览器门:实体页动作渲染/两步确认(T39 canonical renderer 复用,
  零新增硬编码,I3) `e2cc3a73`
  (核实:渲染链全既有,缺口=ApplicationRenderer 不渲染动作面;最小接线 MetaActions)
- [x] Task: CLI 门(meta 写通道;形态按 P0 复核结论:通用 meta actions exec 或
  最小 `apps deprecate` 适配)+ audit 回读 `01eb9927`
  (P0 复核后口径:CLI=agent 通道,deprecate 获引擎 actor-is-human 诚实拒绝(I4
  同门),人通道执行、agent 通道拒绝+审计回读;测试固化此裁定;裁定 A=零客户端
  特判,引擎拒绝为唯一权威;零生产改动)
  (GR3 顺带拆解:meta/renderers 目录超限,P4a 测试推过线,按 D53 拆 generic/ 子
  目录 91201168)
- [~] Task: e2e 独立 spec(t52-*.spec.ts):genesis 出生→写数据→停用→全收缩断言
  (发现/目录/实体/集合/授予/面板)→ 同名重建被拒 → 重放一致;invariants 扩展
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5 — 收口

- [ ] Task: 全量门禁:`pnpm check`(governance:strict)+ `CI=true pnpm e2e` +
  `CI=true pnpm e2e invariants`
- [ ] Task: 文档同步(AGENTS.md 事件词汇/模块行;GOAL.md 修订判定显式记录)
- [ ] Task: Track 收口(archive、registry、DONE;部署站清理走查 US7 待用户按
  DEPLOYMENT 流程发布后另行执行)

- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## 附录 A — 开工前事实复核记录(2026-09-04,Phase 0 Task 2 产出)

只读复核(17 项清单 + 11 项新增发现)全文见 git note;对执行形态有直接影响的结论:

1. **路径更正**(spec 引用随执行更新):sitemap 实为 `packages/engine/src/contract/sitemap.ts`(非 projection/);meta-bootstrap 实为 `packages/engine/src/definition/meta-bootstrap.ts`(非 apps/web)。行号/机制均吻合。
2. **CLI 通用 meta 执行通道已存在**(`apps/cli/src/commands-business.ts:53-54`,`meta/`/`draft:` rel 自动走 `/_meta/api/exec`,exec 前读实体 actions 要求已声明)→ **P4 CLI 任务收窄为「合同测试 + 审计回读验证」,零新命令**。spec §6.10 遗留验证点关闭。
3. **GR3 双触顶风险(落位决定)**:`definition/` 目录 effective 合计 3861/4000(余 139);`contract/siren/project-meta.ts` 485/500(余 15,而 `meta/application:` 实体 actions 现硬编码 `[]` 于 :492,恰需扩)→ 新引擎文件一律落**新功能子目录** `definition/application-lifecycle/`(镜像 `definition/bundle/` 先例,D53 沿功能边界拆解);实体动作镜像逻辑落**新投影文件**(不进 project-meta.ts)。
4. **事件词汇落点**:EngineEvent 现不含 seed 族;`application-deprecated` 走 meta exec events 数组伴随追加(镜像 definition-deprecated)→ **三处都要加字面量**:db `events.ts` EventKind、engine `log-event.ts`、engine `effects.ts` EngineEvent(kind union :31-53)。
5. **受众 fail-open 面比 spec 宽**:`metaApplications` 对集合 rel 恒 `[]`(集合本身永远 reachable),成员靠 `filterEntityForGrantedApplications` 逐子过滤——停用应用的 `meta/application:<name>` 子项若解析 `[]` 则**不被过滤、集合内仍可见**。D71.3 实施必须同时覆盖:rel 级解析(business/meta 双函数)与集合成员过滤两层面。
6. **确认门先例口径**:definition `deprecate` 只有 `no-live-instances` guard 无确认门;human+high 组合先例是 approve/reject(lifecycle.ts:124-142)。APPLICATION_LIFECYCLE 的 deprecate 声明 high 后,`/_meta/api/exec` 既有 suspended 分支(route.ts:112-124,现注释「理论不可达」)即被激活——P3 验证含 **CLI 对 202+confirmation 的消费**。
7. **重启不复活双保险**:planMetaBootstrap 除 receipt 整包幂等外另有 per-identity 按 `application-seeded` 事件名集补缺判重(:102-116)→ G4 依据比 spec 更强。
8. **披露钩子只覆盖 approve 方向**(D70.1);deprecate 收缩方向无披露——非目标,不扩。
9. **并发互斥先例**:activate-application 的 `pg_advisory_xact_lock` + 锁内重读;引擎 exec 走 service 串行队列。
10. **fold 未知 kind 纪律落点**:fold/index.ts:306 default throw;app-known 不变式实现于 definition/invariants.ts:334-343;fold 主测试 `projection/fold.test.ts`。
