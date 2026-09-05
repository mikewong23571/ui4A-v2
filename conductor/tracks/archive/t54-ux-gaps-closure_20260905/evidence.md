# T54 缺口闭环证据(G01–G15)

> 纪律(remaining-gaps.md「建议实施顺序与完成标准」):每项关闭须有修复 commit、
> 适用范围、精确测试命令及结果、部署 SHA/digest、浏览器原故事复验与截图;
> 「测试全绿/已提交/已部署」互不替代。本地证据齐备项标记「本地闭环」;
> 部署站复验统一记入文末「部署站复验」节(发布待用户,先例 T51 US7/T52 US7)。
> 测试计数为各 Phase 亲跑结果;文末另附全量门禁命令与总数。

## G01 严格策略确认批准(P1)— 本地闭环

- 根因(探针坐实,附录 B):confirmDeps 无生命周期伪流(声明层拒绝)+
  approveConfirmation 只重放目标动作效果(不产伴随事件)。
- 决定:D74(批准经 executeMeta 同一事件计划,伴随事件入决定事务)。
- 修复:0aa984ab(engine 钩子 + web 装配 + 批准路径镜像 T52 缺陷 A/B 修复)。
- 验证命令:`CI=true pnpm vitest run packages/engine/src/definition/application-lifecycle/application-deprecation.test.ts --project unit`(12 passed);
  `CI=true pnpm vitest run apps/web/src/engine/service-tests/service.meta-confirmation.test.ts --project db`(3 passed:同一事件计划+级联+重启/
  重复至多一次+agent guard 拒+目标漂移结构化拒/全 log 重放逐表一致)。
- 范围:engine meta 面(应用停用/定义生命周期动词);draft: 前缀经 web drafts
  自有编排,不在确认门(人Only原子,记录于 plan)。

## G02 停用响应语义与稳定回执(P1)— 本地闭环

- 决定:D73(403 族细分 application_deprecated;D71.3 尾句修订;不得一刀切 404)。
- 修复:ada58d41(assertReachable 细分 + 错误码 union/forbidden 集合 + 合同测试
  含活跃未授予对照;MetaEntityHttpError 携带结构化码;meta 实体页三态分型卡
  (应用已停用/无权访问/服务不可用)+ 目录/返回出口;页面级回执稳定宿主
  (renderers/meta-receipt,错误态展示「历史回执」口径,不以成功快照冒充当前事实))。
- 验证:`... application-scope.test.ts --project unit`(21 passed,含 D73 分型对照);
  `... deprecated-applications.contract.test.ts --project db`(5 passed);
  `... meta-entity-page.test.tsx + meta-receipt.test.tsx --project unit`(6 passed)。
- 遗留(stale 逐 app 凭证投影缺位 404):现状维持(T52 已钉),D73.3。

## G03 知情确认与决定回执(P1)— 本地闭环

- 修复:8d973ed8(rejectedBy 线上/fold 双侧持久化(I5 逐字段 parity);投影身份行
  全生命周期+风险标注;resume(对象+参数有界摘要+策略原因)经 inbox detail 绑定;
  decided-by/rejected-reason 入投影=决定回读;终态无动作面)。
- 验证:`... contract/siren.test.ts --project unit`(35 passed 含 G03 两用例);
  `... execution/confirmation.test.ts --project unit`(25 passed 含 fold parity);
  `... render/words/member-card.test.tsx --project unit`(7 passed 含知情卡用例)。
- 390px 触达与两类对象浏览器知情判断:归部署站复验;有界证据合同:无当前
  强制需求(挂起请求原文已完整保留于确认实体),不预建。

## G04 激活证据时点(P1)— 本地闭环

- 修复:ada58d41(「旧日志」无据推断→「证据不可得,不作时间推断」+meta/flow
  版本出口;bundle 投影对已安装目标附时点明细「当前事实,不是批准失败」;
  draft checks 标题标注按当前事实重算;不给历史补造 PASS)。
- 验证:`... activation-view.test.tsx --project unit`(7 passed 含 G04a);
  `... engine/drafts/application-bundle-projection.test.ts --project unit`(2 passed);
  `... engine/drafts/application-bundle*.test.ts --project db`(17 passed 回归)。

## G05 工作区编辑预填(P2)— 本地闭环

- 探针(附录 C):fresh entity/集合成员/repeat 载荷/item 路径四跳全活;丢失点=
  actions-entity 切片缺 properties.fields。
- 修复:6f698882(compiler 切片携带源实体 fields)。
- 验证:`... service-tests/presentation/g05-prefill-probe.test.ts --project db`
  (1 passed,五段断言)。冲突/新鲜度:提交 fresh-read 既有合同(T28);
  未保存输入不被背景刷新覆盖=表单本地状态,浏览器复验项。

## G06 业务收尾动作(P2)— 本地闭环;部署站交付=同形状 Draft

- 修复:fad17ccd(todo done.archive;post offline.edit(title/body set-field)+
  offline.archive;g06-closure-actions:无绕路归档/agent 同门/编辑身份保留+事件链/
  born-version 边界经受治理 Draft 修订钉测)。
- 验证:`... service-tests/g06-closure-actions.test.ts --project db`(3 passed);
  `... applications/bundles.test.ts --project unit`(2 passed)。
- 边界裁定:新动作仅对激活后出生实例可用;存量实例守出生合同;存量迁移需
  另立受治理决定(不偷偷改 bornVersion)。部署站:经同形状 Flow Draft 治理交付。

## G07 工作线材料选择(P2)— 本地闭环

- 修复:3c5b37f4(subagent 实施+编排亲跑复核)。收敛点=ActionGroup(全宿主
  共用裸 rel 表单的真实位置,首页工作线/实体页/画布注视面一并收敛);
  ThreadMaterialAdd 选择器主路径+「高级」裸 rel 回退;候选可区分标题
  (声明字段值→全组仅集合级同名兜底时退 rel);已挂禁选;移出走合同 detach;
  零服务端改动。
- 验证:`... canvas/thread-desk-selector.test.tsx actions/thread-material-add.test.tsx
  actions/action-group.test.tsx --project unit`(19 passed);canvas+actions 域
  76 passed(拆 desk/ 子目录后 50/53 复验)。

## G08 处境/标签/通用 UI(P2)— 部分本地闭环

- 处境:fad17ccd(contextEntityTitle 扩 meta 合同身份键:Draft target/
  Activation flow+version;顶栏不再「无法读取」)。验证:situation-contract
  测试(含新用例)随批 84 passed。
- 通用 UI:timeline 日期本地时区(核证既有);draft 过期时间本地化 1921d6cc
  (9 passed 回归)。
- 业务标签(主读面 presentation role/rel 退原始合同/激活披露合同名称):激活
  披露已按 D70/T51 用授权合同名称;主读面标签治理跨面广,按文档「按复现与
  收益收敛」记部分完成,部署站复验后定剩余。

## G09 捕捉流程身份(P2)— 本地闭环;部署站存量实例按出生 v7

- 根因(subagent 四环节引证):bundle 捕捉输入字段误声明 presentation role
  identity→「再记一条」后残留产物名顶替实例身份(投影 explicitIdentity 回退链)。
- 修复:3c5b37f4(ideas/todo bundle 捕捉输入 role→metadata,v8 出生版本纪律;
  捕捉区标题回退声明流程任务名;残留字段不清(零效果改动);产物身份仍在
  item 流;回环引擎测试+规划级钉)。
- 验证:`... contract/siren.test.ts presentation/surface/generic-detail-surface.test.ts
  applications/bundles.test.ts --project unit`(48 passed)。
- 部署站:存量实例出生 v7 仍见旧行为(预告语义);新版经重播种/激活生效。

## G10 助手注意力(P2)— 引用标签本地闭环;真实 LLM 评估=部署站/eval

- 修复:a30eb1bb(引用可点标签用授权实体声明名称懒取,失败回退已披露 rel;
  JSON Pointer 退审计 title 属性)。验证:citation-list 4 passed。
- 重复注入:每步 fresh-read 是 D54 披露纪律的有意设计(附录 A.2/§6.10),
  「当轮内不必要重复」的收敛需真实 LLM 轨迹分析——归 eval:llm/部署站
  (provider 未配置则记 NOT RUN,先例 T39 US19)。

## G11 历史会话状态(P2)— 本地闭环

- 修复:fad17ccd(subagent 实施+编排亲跑复核):「上次回合:待确认」历史口径;
  截断钉测;其它终态措辞不回归。验证:session-list 4 passed;chat 域 74 passed。
- 「当前是否仍待确认」并列:需确认引用入会话摘要投影(数据面扩合同),
  超出最小边界,留待(记录)。

## G12 错误恢复(P2)— 保留开放(定向复现未执行)

- 处置:文档明示「需针对网络中断、LLM 不可用、过期授权再复现」;本地无法
  如实复现三类浏览器态,按 spec §7.4 不做无证据修复。复现步骤清单入
  remaining-gaps 收口注记(断网中途/提交成功响应丢失/认证过期/provider 超时)。
- 已具备的结构化基础:G02b 三态分型卡+出口;chat failure words(既有);
  202 解析修复(F-R11 线,已部署)。

## G13 审计过滤(P2)— 本地闭环

- 修复:fad17ccd(subagent 实施+编排亲跑复核):domain(合同枚举)/kind(精确)
  显式过滤+状态可见+一键清除+游标无丢失重复+空态区分;默认首载 URL 逐字不变。
- 验证:events/page.test.tsx 10 passed;typecheck/governance 绿。
- 收件箱复用工作站呈现:既有 inbox/决策卡共用(G03 member-card 单一词条面),
  A27 入口重走归部署站复验。

## G14 message 引用解引用(P2)— 本地闭环(生产者侧核实+投影补齐)

- 追踪:写入形状规范(`message:<messageId>`,chat-thread.ts:28,canonical
  chat-message-appended);缺的是读取面,非写入错误。
- 修复:bbef6eb0(principal 受约束只读投影;跨 principal 与缺失同形 404;
  sessionId/turnId 定位回会话;零动作面)。验证:message-entity 3 passed;
  entity route 回归 21 passed。
- 存量错误引用解除动作:本轮无复现样本(A26 上一轮证据),如部署站复现按
  声明的移出/替换引用动作处理,不自动删源消息。

## G15 视觉与操作说明(P2)— 已定型语义下的小修完成;其余复现先行

- 完成:过期时间本地化(1921d6cc);标点全角纪律(G02b 文案);B14/B15 既有
  修复核证。390/768/1440 全幅走查、确认区层级压缩、图标可见短标签:
  G03/G08 语义已定型,归部署站复验批次;B18 截图伪影:先比 DOM/viewport,
  未证实不改。

## 部署站复验(发布待用户;先例 T51 US7 / T52 US7)

清单:P1 四项原故事(G01 严格策略 c6 批准链/G02 停用回执与旧入口/G03 两类
对象知情判断/G04 新激活页陈述)+G05/G07/G09 主故事+G13 过滤复验+G10 真实
LLM(eval:llm 或部署站对话)+G15 三断点走查。部署 SHA/digest 与截图在发布
后补记本节。
