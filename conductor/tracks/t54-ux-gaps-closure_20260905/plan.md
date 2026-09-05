# T54 深度体验遗留缺口闭环 — Plan

> 状态:**new**(2026-09-05,规划完成未开工)。执行纪律:严格 TDD(先红后绿);
> 每任务完成即 commit + git note;Phase 结束跑 Phase Checkpoint(自治验收,workflow
> 自治编排协议);GR1–GR5 全程生效(治理失败只如实报告,不裁剪代码,D53);
> 逐缺口闭环证据标准见 spec §4(逐缺口验收细节以 remaining-gaps.md 各节「验收」段
> 为准,本 plan 不复制)。执行期发现新事实按 workflow「Task Correction」回写并注明。

## Phase 0 — 开工前事实复核与语义裁定 [checkpoint: f335a021]

- [x] Task: 事实复核:spec §6 引用的 file:line 逐项复核(代码可能漂移),结论回写
  本 plan 附录 A;G01/G05/G09 的探针方案按漂移情况修订 `f335a021`
- [x] Task: G02 语义裁定(spec §4 D73 候选):核对 D51/D71.3「停用面=存在性隐藏
  (404)」vs 实现钉 403 `scope_insufficient`(deprecated-applications.contract.test.ts)
  ——裁定「修正实现」或「落新决定」,DECISIONS 先行落盘;区分停用面/跨 principal
  隐藏/从未存在/真正无权限四态映射 `f335a021`
  (裁定 = D73:403 族细分 application_deprecated,维持 D51 失败语义,D71.3 尾句修订)
- [x] Task: G01 探针:隔离测试库(vitest db project,禁指开发库)+ 注入严格策略,
  列出直接 Meta 执行与确认批准两条路径的事件差异清单;据此产出确认编排详细设计
  (与直连执行共享事件计划/engine 纯规划/web-db 事务装配/幂等与并发边界/只消费
  挂起精确请求),回写附录 B;「无伴随事件」现状测试(application-deprecation.test.ts:276-313)
  的规范地位明确,按需先更新 DECISIONS `f335a021`
  (探针绿:直连 [action-executed, application-deprecated] vs 批准 [action-rejected];
  设计 = D74,附录 B.2;策略文件无注入口 → 事件直插 pending,fixture 惯例)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `f335a021`

## Phase 1 — G01 严格策略确认批准(engine + web/db) [checkpoint: 0aa984ab]

- [x] Task: engine 测试先行:approveConfirmation 确认批准编排——重读当前目标、
  重验声明/guard/schema 与当前定义事实、生成与直连执行同一停用/激活事件计划、
  目标已变化结构化拒绝、保留原提议者与批准者;按 Phase 0 规范地位修订
  application-deprecation.test.ts「无伴随事件」现状预期(先红) `0aa984ab`
- [x] Task: engine 实现绿:纯业务规划层扩展(无平台依赖,GR1);先复用现有边界
  (executeMeta 事件规划/lifecycle 伪流),不建新通用框架;新裁决分支独立文件落位
  (D53 膨胀即拆解) `0aa984ab`
  (落位:钩子挂在既有 confirmation.ts 的 ConfirmationDeps(类型专用 import 借
  MetaOutcome 形状,零运行时环);无新文件必要,confirmation.ts 仍在 GR3 限内)
- [x] Task: web/db 事务装配:confirmDeps 确认批准口径(可见生命周期伪流)/确认
  决定 + 业务伴随事件**同事务提交**/重复与并发批准至多生效一次/失败事务不留半条
  决定;不放宽 Cedar、不伪造 human、不重复 POST `0aa984ab`
  (实现口径:伪流不进 confirmDeps.flows(业务注册表),meta 编排由钩子内部自举;
  事务=既有 appendEventBatch 单事务;T52 缺陷 A/B(停用回执 500/同进程烧毁集)
  镜像到批准路径 service-confirmation.ts)
- [x] Task: 验收族(服务层 + invariants):严格策略下申请→pending→重启→批准→
  应用退出目录且相关定义置废;agent 批准拒绝;授予外拒绝;完整重放与在线状态一致 `0aa984ab`
  (service.meta-confirmation 三项:同一事件计划+级联+重启/重复至多一次+agent
  guard 拒+目标漂移结构化拒绝/全 log 重放逐表一致;授予外拒绝由既有
  deprecated-applications.contract + application-scope 套件覆盖)
- [x] Task: 浏览器原故事复验(严格策略 c6:目标、决定回执、旧入口不可达,不只查
  节点值)+ CLI agent 通道诚实拒绝复验;证据截图入 evidence `0aa984ab`
  (裁定:本地默认策略下 human deprecate 直通、agent 被 guard 前置拒,pending
  无法在本地 e2e 自然产生——服务层 db 测试为本地覆盖;严格策略浏览器复验归
  Phase 8 部署站走查(待用户发布,T51/T52 先例);CLI=同一 /_meta/api/exec
  合同,agent 批准拒绝已由服务测试钉住)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `0aa984ab`

## Phase 2 — G02/G04 诚实性小修 [checkpoint: ada58d41]

- [x] Task: G02a 停用后响应语义按 Phase 0 裁定实现(测试先行修订合同测试);
  客户端「不可再访问」与网络/5xx 故障分型;不把所有 403 粗暴改 404 `ada58d41`
  (D73 落地:application_deprecated/scope_insufficient 分型 + 活跃未授予对照例)
- [x] Task: G02b 稳定宿主成功回执:MetaEntityPage 错误分支切换不卸载丢失
  lastOutcome/lastDisclosure;提供目录/返回出口;刷新后按授权合同呈现历史结果或
  不可访问状态,不沿用临时成功快照冒充当前授权事实 `ada58d41`
  (meta-receipt context 页面级宿主 + 三态分型卡 + MetaEntityHttpError 携带结构化码;
  「历史结果」口径标注;标点按 G08 全角纪律)
- [x] Task: G04a 无依据陈述小修:「当前激活未附此项证据」事实陈述;沿已声明
  Draft 关系到达现有 diff;缺字段不推断生成时间 `ada58d41`
  (activation-view「旧日志」→「证据不可得,不作时间推断」+ 定义版本出口链接)
- [x] Task: G04b 证据时点分离:「批准时依据/执行结果/当前事实」三层,优先从已有
  不可变版本/事件读取,未保存足够证据标记不可得;结构化数组/对象走通用回执渲染器
  (不转义 JSON);新应用批准前未安装检查通过、批准后不把「现在已安装」当旧检查失败 `ada58d41`
  (projectApplicationBundleDraft 对已安装目标附时点明细「当前事实,不是批准失败,
  批准时依据以提交/接受事件为准」,不补造 PASS;draft checks 标题标注「按当前事实
  重算」;回执结构化值经 DisclosureValue 既有渲染)
  (GR3/D53 顺带拆解:components/meta 超限 → activation/ 子目录,镜像 renderers/generic 先例)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `ada58d41`

## Phase 3 — G03 知情确认与决定回执 [checkpoint: 8d973ed8]

- [x] Task: 投影与呈现扩展(测试先行):projectConfirmation 补决定者/理由等缺口
  字段;确认卡默认展示「对谁、做什么、为何需决定」——目标身份与动作 title 复用
  授权实体,字段摘要按合同 presentation/schema 生成,缺前值不猜测 `8d973ed8`
  (身份行全生命周期+风险标注;resume=对象 rel+参数有界摘要+策略原因,经既有
  inbox detail 绑定通道;缺前值不猜测)
- [x] Task: 决定后回读:状态/理由从日志投影恢复(临时反馈只作即时补充);首页/
  画布/实体页共用决策词汇与动作组,减少重复图例与嵌套盒子;批准/驳回/high 两步
  确认仍按当前合同与机制执行,不新增按钮分支、不一律加确认 `8d973ed8`
  (rejectedBy 线上/fold 双侧持久化(逐字段 parity 钉测);decided-by/rejected-reason
  入投影,确认 rel 直读即回执;共用决策词汇=member-card 单一词条面;图例压缩归 G15)
- [x] Task: 边界验收:归档想法与停用实验应用两类对象知情判断;无权限目标不泄露
  名称或参数;长内容可展开;390px 按钮可达;陈旧确认不显示虚假成功;需要批准时
  快照才能解释历史变化的,先定义有界证据合同(不用今天的字段值充当昨日前值) `8d973ed8`
  (无权限不泄露:确认读取受众门既有套件覆盖;陈旧确认:终态无动作面+member-card
  钉测;两类对象知情判断与 390px 走 G15/部署站复验;有界证据合同:本阶段无强制
  需求,挂起请求原文已完整保留于确认实体,不预建)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `8d973ed8`
  (顺带:activation/ 移至 components/activation/——meta 路由扫描误判模块路径
  +meta 目录预算双因素;gr/单测/全量复跑绿)

## Phase 4 — G05/G07/G09 操作顺畅性 [checkpoint: 3c5b37f4]

- [x] Task: G05 探针:fresh entity → Surface 绑定/解引用 → 词汇 → ActionGroup
  逐段对比 `properties.fields`,定位丢失点 `6f698882`
  (附录 C:服务端四跳全活;丢失点=actions-entity 切片缺 fields)
- [x] Task: G05 实现:与实体页一致的预填;冲突/新鲜度沿 T28 fresh-read 既有
  合同;未保存输入不被背景刷新覆盖=表单本地状态(浏览器复验项) `6f698882`
  (切片携带源实体 properties.fields;fast-check 性质按预填通道修订:保留
  「已选⇒在场」与「组件零字面」不变量 3c5b37f4)
- [x] Task: G07:首页/实体页/画布注视面的工作线材料添加收敛到选择器主路径
  (ActionGroup 收敛点,ThreadMaterialAdd);裸 rel 降为显式高级回退;候选
  可区分标题(声明字段值,全组仅集合级兜底时退 rel);重复禁选、移出不删除;
  无权限候选不可见;零服务端改动;CLI 不受影响 `3c5b37f4`
  (subagent 实施+编排亲跑复核 19+76 测试)
- [x] Task: G09:捕捉区以声明流程任务名定位,产物经集合关系可达;bundle
  role identity→metadata(ideas/todo v8 出生版本纪律);不写 flow.name 特判、
  不清业务字段;回环引擎+规划双钉 `3c5b37f4`
  (subagent 实施+编排亲跑复核 48 测试;部署站存量实例按出生 v7,预告语义)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `3c5b37f4`
  (顺带 GR3/D53 拆解:components/canvas → canvas/desk/ 子目录 ac43e237)
## Phase 5 — G06 业务收尾动作(另立小故事) [checkpoint: fad17ccd]

- [x] Task: 小故事与合同核对:待办「完成后归档」、文章「下线后归档/编辑正文」;
  born-version 边界裁定:新动作仅对激活后出生实例;存量守出生合同;存量迁移
  需另立受治理决定,不偷偷改 bornVersion `fad17ccd`
- [x] Task: 声明落地:todo done.archive;post offline.edit(title/body set-field)+
  offline.archive;界面继续自 Siren 动作生成;不经「先重开再归档」;编辑保留
  身份与历史 `fad17ccd`
- [x] Task: 复验:人/agent 同门、事件链可追溯、born-version 边界经受治理
  Draft 修订钉测(新实例可见新动作,修订前实例结构化拒绝);两应用 HTTP/引擎级
  全过;浏览器=e2e 全量;部署站经同形状 Flow Draft 交付 `fad17ccd`
  (g06-closure-actions 3 测试;flows.test/contract.test 种子钉随合同更新)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `fad17ccd`
  (未超 remediation 边界,无需拆出后续 track)
## Phase 6 — G08/G11/G13 确定性小修 [checkpoint: fad17ccd]

- [x] Task: G08-处境:contextEntityTitle 扩 meta 合同身份键(Draft target /
  Activation flow+version),顶栏不再「无法读取」;单点处境装配不变 `fad17ccd`
- [x] Task: G08-标签:激活披露已按授权合同名称(D70/T51 既有);主读面业务
  标签治理跨面广——按文档「按复现与收益收敛」记部分完成,部署站复验定剩余 `fad17ccd`
- [x] Task: G08-通用 UI:timeline 日期本地时区核证(既有);draft 过期时间
  本地化 `1921d6cc`;新增文案全角标点纪律;业务名来自合同不翻译(核证) `fad17ccd`
- [x] Task: G11:session-list「上次回合:待确认」历史口径;截断钉测;其它终态
  措辞不回归;「当前是否仍待确认」并列需确认引用入会话摘要投影,超出最小边界
  留待 `fad17ccd`(subagent 实施+编排复核 4/74 测试)
- [x] Task: G13:events 页 domain(合同枚举)/kind(精确)显式过滤+状态可见+
  一键清除+游标无丢失重复+空态区分;默认首载 URL 逐字不变;A27 入口重走归
  部署站复验 `fad17ccd`(subagent 实施+编排复核 10 测试)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `fad17ccd`
## Phase 7 — G10/G12/G14/G15 复现先行收敛 [checkpoint: bbef6eb0]

- [x] Task: G10:引用可点标签用授权实体声明名称(懒取,失败回退已披露 rel),
  JSON Pointer 退审计 title 属性 `a30eb1bb`;当轮重复注入收敛与提示优化需
  真实 LLM 轨迹——归 eval:llm/部署站(provider 未配置则记 NOT RUN,先例
  T39 US19);每步 fresh-read 为 D54 有意设计,不废除
- [x] Task: G12 定向复现:本地无法如实复现三类浏览器态(网络中断/LLM 不可用/
  过期授权),按 spec §7.4 不做无证据修复——保留开放,复现步骤清单入
  evidence;结构化基础(G02b 三态分型+出口/202 解析)已具备
- [x] Task: G14 追踪与裁定:写入形状规范(message:<messageId>,canonical
  chat-message-appended),缺读取面非生产者错误;补 principal 受约束只读投影
  (跨 principal 与缺失同形 404;sessionId/turnId 定位;零动作面);存量错误
  引用解除按声明动作处理,不删源消息 `bbef6eb0`(3 单测+route 回归 21)
- [x] Task: G15:已定型语义下小修(过期时间本地化 1921d6cc;标点纪律);三断点
  走查/确认区层级/图标短标签归部署站复验批次;B18 未证实不改 `1921d6cc`
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) `bbef6eb0`
## Phase 8 — 收口 [checkpoint: 待终验后回填]

- [ ] Task: 全量门禁:pnpm check(governance:strict)+ CI=true pnpm e2e +
  CI=true pnpm e2e invariants(结果回填)
- [x] Task: 闭环证据汇总:evidence.md(G01–G15 逐缺口 commit/命令/结果/边界
  裁定;G12 保留开放与部署站清单如实);remaining-gaps.md 状态列+收口注记
  `49294655`
- [x] Task: 文档同步:AGENTS.md chat 模块行补 message: 投影 `82e74d4a`;
  GOAL/product/tech-stack 判定无需修订(T54 为修复与呈现细节+两 bundle 动作,
  不改 DONE 范围与栈;理由入 git note)
- [ ] Task: Track 收口(archive、registry、DONE;部署站复验待用户发布)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
## 附录 A — 开工前事实复核记录(Phase 0 Task 1 产出)

复核时点:2026-09-05,HEAD 29e33032(T54 初始化提交;其后仅本 track 改动)。
方法:spec §6 全部 16 处 file:line 引用逐条机械抽查(sed 定位行内容比对)。

1. **零漂移**:16/16 引用全部命中(规划期 Explore 核查在 d980f797 完成,
   其后仅 conductor 文档变更);G01/G05/G09 探针方案无需修订。
2. **补充核证(规划期未列)**:
   - `appendEventBatch` 单事务(`packages/db/src/events.ts:305-314`,
     `withDatabaseTransaction`)——D74「伴随事件入决定事务」由既有机制满足,
     不新增事务边界;
   - `executeWithGates` = judge → confirmGate → applyEffects 三段
     (`packages/engine/src/execution/execute.ts:68-116`),`MetaDeps.policy`
     即确认策略,缺省内置(human 直通)——meta 钩子复用该编排时天然不再挂起;
   - Cedar 策略自文件装载且 boot 无注入口(`service.ts:274`
     `cedarPolicyFromDefaultFile()`)——探针以事件直插 `confirmation-requested`
     物化 pending(仓库 fixture 惯例);
   - fold 对 `confirmation-requested` 的物化与 `suspendForConfirmation` 逐字段
     同构(`projection/fold/apply-confirmation.ts:15-54`),fixture 形状有据。
3. **G02 裁定输入**:D51 权威文本(DECISIONS.md:837)「HTTP 404 仅保留跨
   principal 的存在性隐藏」与 D71.3 尾句「停用面=404」冲突;实现钉 403/404
   两态(治理展开 403 `scope_insufficient`;遗留逐 app 凭证投影缺位 404)。
   裁定 = D73(403 族细化 `application_deprecated`)。

## 附录 B — G01 探针结论与确认编排详细设计(Phase 0 Task 3 产出)

### B.1 探针结果(service.meta-confirmation.test.ts,隔离测试库,2026-09-05)

| 路径 | 事件序列(业务 rel 维度) | 业务状态 |
| --- | --- | --- |
| 直连(默认策略 human 直通) | `[action-executed, application-deprecated]` | applications 删键 + 同 app 定义置废 |
| 批准(严格策略挂起 → approve) | `[action-rejected]`(reason:目标动作未声明于节点) | 不动(应用仍在目录) |

根因双层:①confirmDeps 仅活跃业务定义,生命周期伪流(`application-lifecycle`)
不在注册表,approveConfirmation 声明层拒绝(execution/confirmation.ts:414-422);
②即便声明可解析,approveConfirmation 只 applyEffects 重放目标动作
(confirmation.ts:439),不产 `application-deprecated` 伴随事件与级联
(该现状被 application-deprecation.test.ts:276-313 钉死)。

### B.2 设计(D74)

- **engine**:approveConfirmation 对 meta 目标(confirmation.targetRel 前缀
  `meta/` 且 deps 提供 meta 执行钩子)跳过本地声明定位与 applyEffects,改以
  委托请求(挂起 params/paramOrigins 原文,actor=human、principal=提议者
  principal、channel='confirmation')调用钩子(= executeMeta,内置确认策略,
  不再挂起);钩子 rejected → 原样结构化拒绝留痕;executed → 前置
  confirmation-approved 事件 + 确认表置 approved,事件序列
  `[confirmation-approved, action-executed, application-deprecated]`。
  业务面(非 meta)路径与语义不变。
- **web**:service.ts confirmDeps 装配钩子 `executeMeta(request, snapshot,
  { ...metaDeps(), policy: undefined })`(纯引擎函数,装配留在 web);
  confirmDeps.flows 维持仅活跃业务定义。
- **事务**:批准决定 + 伴随事件经既有 appendEventBatch 单事务(附录 A.2);
  重复/并发批准由 pending 状态裁决至多一次。
- **重放**:fold 已按 [confirmation-approved → action-executed →
  application-deprecated] 顺序折叠(I5 由既有 fold 语义保证,测试钉住)。
- **测试翻红**:service.meta-confirmation.test.ts 第二项断言改为 accepted +
  同一事件计划;application-deprecation.test.ts:276-313 现状预期按 D74.5 修订
  (改钉「批准经同一编排产出伴随事件」);补引擎级纯函数测试(钩子注入/拒绝
  透传/非 meta 不变)。

## 附录 C — G05 预填丢失点探针结论(Phase 4 Task 1 产出,commit 6f698882)

逐段探测(service-tests/g05-prefill-probe,ideas 应用全链):
①fresh entity properties.fields ✓ → ②集合成员子实体 ✓ → ③surface 依赖 +
repeat 水合载荷(updateDataModel.repeats)✓ → ④member 词 item 路径
(properties/fields)编译 ✓——服务端与成员词全链存活。

**丢失点**:entity 形状区域(detail controls 词)的 `actions-entity` transform
切片只携带 rel/actions/guard-results,不带 properties.fields(render/presentation/
compiler.ts transformedValue)→ 工作区编辑表单 ActionGroup 预填为空;实体页
直连全量实体故可预填(R17/R18 现象完全解释)。

**修复**:切片携带源实体 properties.fields(合同事实);探针断言翻绿。
表单新鲜度/冲突语义:提交 fresh-read 既有合同(T28);未保存输入不被背景刷新
覆盖=表单本地状态,浏览器复验项。
