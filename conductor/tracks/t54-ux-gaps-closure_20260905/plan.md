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

## Phase 2 — G02/G04 诚实性小修

- [ ] Task: G02a 停用后响应语义按 Phase 0 裁定实现(测试先行修订合同测试);
  客户端「不可再访问」与网络/5xx 故障分型;不把所有 403 粗暴改 404
- [ ] Task: G02b 稳定宿主成功回执:MetaEntityPage 错误分支切换不卸载丢失
  lastOutcome/lastDisclosure;提供目录/返回出口;刷新后按授权合同呈现历史结果或
  不可访问状态,不沿用临时成功快照冒充当前授权事实
- [ ] Task: G04a 无依据陈述小修:「当前激活未附此项证据」事实陈述;沿已声明 Draft
  关系到达现有 diff;缺字段不推断生成时间
- [ ] Task: G04b 证据时点分离:「批准时依据/执行结果/当前事实」三层,优先从已有
  不可变版本/事件读取,未保存足够证据标记不可得;结构化数组/对象走通用回执渲染器
  (不转义 JSON);新应用批准前未安装检查通过、批准后不把「现在已安装」当旧检查失败
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 3 — G03 知情确认与决定回执

- [ ] Task: 投影与呈现扩展(测试先行):projectConfirmation 补决定者/理由等缺口
  字段;确认卡默认展示「对谁、做什么、为何需决定」——目标身份与动作 title 复用
  授权实体,字段摘要按合同 presentation/schema 生成,缺前值不猜测
- [ ] Task: 决定后回读:状态/理由从日志投影恢复(临时反馈只作即时补充);首页/
  画布/实体页共用决策词汇与动作组,减少重复图例与嵌套盒子;批准/驳回/high 两步
  确认仍按当前合同与机制执行,不新增按钮分支、不一律加确认
- [ ] Task: 边界验收:归档想法与停用实验应用两类对象知情判断;无权限目标不泄露
  名称或参数;长内容可展开;390px 按钮可达;陈旧确认不显示虚假成功;需要批准时
  快照才能解释历史变化的,先定义有界证据合同(不用今天的字段值充当昨日前值)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4 — G05/G07/G09 操作顺畅性

- [ ] Task: G05 探针:fresh entity → Surface 绑定/解引用 → 词汇 → ActionGroup
  逐段对比 `properties.fields`,定位形状丢失或字段裁剪点(结论可能推翻「服务端没
  保存」假设,回写附录 C 后定实现形态)
- [ ] Task: G05 实现:与实体页一致的合同字段投影预填(仅当前动作 caller schema
  允许的现值,自当前授权实体缓存解引用,Sidecar/模型输出不嵌事实值);表单打开
  确认来源新鲜,提交仍 fresh-read;背景刷新不覆盖未保存输入,冲突保留输入并明确
  要求重读;二次保存/取消重开/并发修改/字段类型变化/隐藏未授权字段用例齐备;
  不重复发送 schema 外字段
- [ ] Task: G07:首页添加材料复用 ObjectSelectorPanel(同一授权发现与提交适配器);
  通用表单需识别实体引用时补声明式字段语义/编辑提示(不按字段名或业务类型特判);
  候选身份与区分信息消费合同声明(可区分标题);重复项禁选、移出不删除;无权限
  候选不可见;缺来源诚实要求补充;ID/目标来源如改客户端提供,先验证 client-owned
  机制并三通道同一 schema;CLI 无 presence 仍能显式创建
- [ ] Task: G09:核对流程入口/当前节点/产物关系及 presentation 身份角色;「准备
  下一次捕捉」以声明的流程/节点任务名称定位,旧产物经明确关系到达;合同缺角色
  区分则补共享呈现语义并经定义治理落地(不写 `if flow.name === ...`,不为改标题
  清除业务字段);想法/待办/新 fixture 连续捕捉复验,实体页/画布/助手处境一致
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5 — G06 业务收尾动作(另立小故事)

- [ ] Task: 小故事撰写与合同核对:待办「完成后归档」、文章「下线后归档/编辑正文」
  各一个小用户故事(现有节点/来源/风险合同核对);born-version 新旧实例边界显式
  决定(按需 DECISIONS;不假定激活新版本自动改写旧实例)
- [ ] Task: 受治理 Flow Draft(适用节点声明动作+必要字段+guard+效果)→ 人批准
  激活 → 界面继续自当前 Siren 动作生成(状态只读视图不新增硬编码业务页);不用
  「先重开再归档」绕路;编辑后原对象身份保留、历史可追溯
- [ ] Task: 复验:新旧版本实例实际可用动作符合明确合同;人/agent 同门、授权与
  风险门不变;至少两种应用按浏览器与 HTTP 复验
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  (执行期裁定:若超出 remediation 边界,按 spec §7.3 拆出后续 track 并在此记录)

## Phase 6 — G08/G11/G13 确定性小修

- [ ] Task: G08-处境:追踪 Draft/activation 的规范 rel、平面与 situation 装配,
  修复正文可读但顶栏「无法读取」的读取路径;仍由单点处境装配提供事实(不用聊天
  关键词猜平面,不把 scope 变权限)
- [ ] Task: G08-业务标签:主读面按 presentation role 展示身份/主要内容/状态,
  rel/flow 等技术键退到原始合同;缺中文标签先补合同 title;激活披露以已授权合同
  名称展示(必要时附 slug),不内置名称表
- [ ] Task: G08-通用 UI:日期按用户时区展示、原时间可审计;身份无授权显示名保留
  ID 或明确当前主体(不猜姓名);Meta 区块标题/控件说明/标点统一;业务动作与状态
  名称来自合同,不按英文动词字符串翻译或路由
- [ ] Task: G11:历史回合状态明确标成「上次回合结果」(suspended 不再像当前待办);
  预览截断已有只钉测试(spec §6.9);如需显示「现在是否仍待确认」,另从该回合
  确认引用重新授权读取,与历史终态并列,不覆写原事件;多会话切换/刷新保留内容
  与 principal 边界
- [ ] Task: G13:事件页显式只读过滤(消费已有 kind/domain/rel 与游标合同,枚举
  来自公开查询合同不在 UI 复制)+ 过滤状态标明/一键查看全部/空态;默认工作事件
  视图不丢弃原始遥测;收件箱入口复用工作站已有 inbox 呈现与确认卡(保留 raw
  入口);A27 当前入口先重走一次再定夺
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 7 — G10/G12/G14/G15 复现先行收敛

- [ ] Task: G10:从当轮真实 prompt/披露和轨迹解释重复读取原因 → 减当轮内不必要
  重复(明确本轮新鲜度/版本边界;执行或版本变化后不去重)→ 提示优化;引用保留
  FactRef、以授权实体/字段声明名称形成可点标签(JSON Pointer 留审计);真实 LLM
  评估:重跑「这个想法缺什么」「只修改这一个」「当前还有什么待批准」及跨应用变体,
  记录耗时/读取次数/token/事实正确性;不以关键词路由或固定回答模拟认知,模型失败
  仍诚实且零未授权副作用
- [ ] Task: G12 定向复现:网络中断/LLM 不可用/过期授权分别再复现(A7/A8)→
  结构化错误恢复面:保留错误码、请求/事件引用与「是否可能已经执行」事实;读请求
  可安全重试;写请求仅幂等键与执行结果可判定时考虑重试,响应丢失先查结果不自动
  重发;普通任务面给适用恢复操作,原始 JSON 退审计抽屉;LLM 不可用时只展示确定
  系统状态与操作入口
- [ ] Task: G14 追踪与裁定:追溯引用写入事件中的真实 message ID、rel 规范与
  owner,比较链接投影与读取协议;合法工作材料则补 principal 受约束的只读投影/
  到会话定位;写入端命名错误则修正生产者 + 用声明的移出/替换引用动作处理用户
  选择的存量引用;无法定位时如实区分不存在/无权/暂不可读(不删消息、不回填快照);
  复现阻断助手上下文即升 P1(spec §4 触发器)
- [ ] Task: G15:G03/G08 数据语义定型后小范围视觉调整(确认区层级/间距/重复图例;
  聊天关键图标无障碍名称+必要时可见短标签;协同/委托说明按真实执行与授权差异
  书写;已归档工作线说明与实际可用动作一致);390/768/1440px + 长名称/多应用/
  长理由用例,键盘/触屏可完成;首页仍最多九项且目录完整;B18 先比较 DOM 与
  viewport 证实、B14/B15 宽屏局部压缩先复现,不为截图伪影重构
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 8 — 收口

- [ ] Task: 全量门禁:`pnpm check`(governance:strict)+ `CI=true pnpm e2e` +
  `CI=true pnpm e2e invariants`;G10 关联 `pnpm eval:llm` 真实 LLM 门(provider
  profile 经 env)
- [ ] Task: 闭环证据汇总(track evidence 文件):逐缺口修复 commit/适用范围/精确
  测试命令及结果/部署 SHA/digest/浏览器原故事复验截图;remaining-gaps.md 缺口
  状态列收口更新(已修复/未复现保留开放等如实标注;临时绕路只记恢复办法)
- [ ] Task: 文档同步:AGENTS.md/GOAL.md/DECISIONS.md 判定修订;
  product/tech-stack/guidelines 按需(无需修订则记理由)
- [ ] Task: Track 收口(archive、registry、DONE;部署站复验若未发布,按 T51/T52
  先例记「待用户按 DEPLOYMENT 流程发布后执行」)
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

## 附录 C — G05 预填丢失点探针结论(Phase 4 Task 1 产出,待回填)
