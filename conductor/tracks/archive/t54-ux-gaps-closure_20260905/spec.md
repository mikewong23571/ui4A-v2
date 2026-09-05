# T54 深度体验遗留缺口闭环(G01–G15)— Spec

> 状态:new(2026-09-05,规划完成未开工)。唯一输入与缺口语义权威:
> [docs/ux-review/2026-09-05/remaining-gaps.md](../../../docs/ux-review/2026-09-05/remaining-gaps.md)
> (浏览器证据基线 c9971648;A/B 体验发现与 R01–R25 证据;产品裁判 = 北极星/GOAL/DECISIONS)。
> 本 spec 不复制该文档的逐缺口验收细节,只做轨道化:目标、分组、顺序、边界与闭环证据
> 标准;**逐缺口验收以该文档各节「验收」段为准**。按 workflow 自治编排协议(2026-08-21
> 授权)规划,规划期事实核查与裁定见 §6/§7,供事后审计。

## 1. 背景与问题

- 2026-09-05 深度体验评审(25 个部署站场景、两轮 A/B)收尾产出 G01–G15 共 15 项
  遗留缺口:P1 四项(影响合同闭环、知情决策或事实诚实性),P2 十一项(影响日常
  流畅性与注意力成本)。
- 已修复项不重开:请求预算(A6,T53 热修 D72)、动作/向导别名缓存(A14/A20)、
  lens 显式选择(A21)、空标题拦截(A19)、窄屏 B14/B15 等;边界以该文档
  「旧发现的状态修订与已完成边界」表为准。
- 编号事实:**T53 已被 D72 热修占用**(fe58641e),本 track 为 T54。
- 规划期事实核查(§6):该文档 10 项关键代码断言 9 项成立、1 项部分成立
  (G11「预览无截断」子断言不成立——session-list 已有 CSS truncate;「历史状态像
  实时待办」子断言成立)。文档事实与 HEAD d980f797 之间零代码漂移。

## 2. 目标(Goal)

**O1 严格策略确认批准闭环(G01,P1)**:确认批准与直接 Meta 执行产出**同一种**
停用/激活事件计划;确认决定与业务伴随事件同事务提交;确认批准只消费此前挂起的
精确请求(保留原提议者与批准者,不重复 POST、不再次挂起)。严禁把「报错」修成
「节点已 deprecated 但应用仍可用」的假成功。

**O2 停用响应语义与稳定成功回执(G02,P1)**:停用面状态码按裁定后的绑定决定执行
(403/404 分歧 Phase 0 先裁定);「不可再访问」与网络/5xx 故障分型;成功回执由
稳定宿主持有,不因实体读取错误分支卸载而丢失;提供目录/返回出口,不靠重试重取
已停用实体。

**O3 知情确认与决定回执(G03,P1)**:确认卡默认展示「对谁、做什么、为何需决定」;
批准/驳回后含结果和理由,刷新仍能回读(从日志投影恢复);无权限目标不泄露名称
或参数;陈旧确认不显示虚假成功。

**O4 激活证据时点诚实(G04,P1)**:区分「批准时依据/执行结果/当前事实」三层;
缺失证据如实说明(标记不可得),不给历史记录补造 PASS;结构化数组/对象由通用
回执渲染器展示,不转义 JSON。

**O5 操作顺畅性(G05/G07/G09,P2)**:工作区编辑预填与实体页一致(G05,探针先行);
工作线创建与材料选择入口一致、复用授权发现选择器(G07);捕捉流程区分「正在新建」
与「上一个产物」(G09,合同呈现角色,不写 flow.name 特判)。

**O6 业务收尾动作(G06,P2,另立小故事)**:待办「完成后归档」与文章「下线后归档/
编辑正文」经受治理 Flow Draft 落地(声明动作+字段+guard+效果);born-version
新旧实例边界显式决定,不偷偷改 bornVersion 或数据库快照。

**O7 注意力成本与复现收敛(G08/G10–G15,P2)**:处境读取路径、合同标签与通用 UI
文案三类小改(G08);助手当轮重复读取与引用标签,真实 LLM 评估(G10);历史回合
状态语义(G11,预览截断已存在不重做);错误恢复入口(G12,复现先行);审计过滤
与任务收件箱(G13);message 引用解引用(G14,复现先行,阻断上下文则升 P1);
剩余视觉项(G15,G03/G08 语义定型后小范围调整)。

## 3. 轨道分组与实施顺序(源自该文档「建议实施顺序与完成标准」,约束不放松)

| Phase | 缺口      | 顺序依据                                                     |
| ----- | --------- | ------------------------------------------------------------ |
| P0    | 复核+裁定 | G01 单独设计(探针先行);G02 先明确 HTTP 语义再小修           |
| P1    | G01       | 不能作为几行 flows 补丁混入 UI 修复                           |
| P2    | G02、G04  | 先小修诚实性(错误分型、无依据陈述、证据时点)                 |
| P3    | G03       | 知情决定与持久回执,接在 G02/G04 之后                          |
| P4    | G05、G07、G09 | 修顺操作(每项均有探针/核对先行子步)                      |
| P5    | G06       | 按应用定义与出生版本另立小故事,与通用渲染改动解耦              |
| P6    | G08、G11、G13 | 已证实的小修,按处境/标签/通用 UI、历史语义、审计过滤分项独立验证 |
| P7    | G10、G12、G14、G15 | 复现先行,按复现与收益收敛;G15 依赖 G03/G08 定型       |
| P8    | 收口      | 全量门禁 + 逐缺口证据汇总 + 文档同步 + 部署站复验              |

## 4. 设计决定与执行纪律

- **D73 候选(G02 语义裁定,Phase 0)**:D71.3 权威文本写「停用面 = 存在性隐藏
  (404),与『从未安装』同形」,而实现与合同测试钉的是 403 `scope_insufficient`
  (§6.3)。Phase 0 必须裁定:修正实现向 D71.3 对齐,或落新决定细化状态码映射
  (区分停用面/跨 principal 隐藏/从未存在/真正无权限)。**不得把所有 403 粗暴改成
  404**;客户端保留结构化错误码。
- **G01 设计纪律**:探针先行(隔离测试库 + 注入严格策略,列出直接 Meta 执行与
  确认批准两条路径的事件差异)→ 详细设计 → 实现。确认批准编排与既有 Meta 业务
  事件规划衔接,重读当前目标、重验声明/guard/schema 与当前定义事实,生成同一种
  停用/激活事件计划;纯业务规划留 engine,事务与装配留 web/db 边界;先检查现有
  可复用边界,不预设新通用框架。修订 application-deprecation.test.ts「无伴随事件」
  现状预期前,先明确该行为的规范地位(按需先更新 DECISIONS)。
- **G01 约束(不可放宽)**:不放宽 Cedar、不删确认日志、不伪造 human、不只手工改
  状态。上轮 c6「恢复默认策略后 human 重新停用」只是操作性恢复,不是修复。
- **G06 born-version 边界**:实例固定出生版本;新实例/旧实例分别决定能力获得方式;
  存量迁移如确有需求,单独定义受治理迁移,不改 bornVersion 或数据库快照。
- **G11 收窄(依据 §6.9 事实核查)**:预览截断已存在(session-list CSS truncate),
  只钉测试不重做;本缺口只修「历史状态像实时待办」语义,及按需以确认引用重新
  授权读取并列「当前是否仍待确认」,不覆写原事件。
- **G10 边界(依据 §6.10 事实核查)**:每步 fresh-read 是有意的新鲜度设计,不是
  事故;修复空间是「当轮内不必要的重复注入」与提示优化,不是废除新鲜度。可缓存
  只读结果必须有明确的本轮新鲜度/版本边界;执行或版本变化后不可盲目去重。
- **G15 依赖与反伪影**:确认区层级/间距调整在 G03/G08 数据语义定型后进行;B18
  疑似截图伪影,先比较 DOM 与 viewport,证实为真实布局问题才改代码。
- **每缺口闭环证据(硬标准,来自该文档)**:修复 commit + 适用范围 + 精确测试命令
  及结果 + 部署 SHA/digest + 浏览器原故事复验与截图;HTTP、授权、并发、重放、
  真实 LLM 等边界分别用对应证据验证;「测试全绿」「已提交」「已部署」互不替代。
  临时绕路只记为恢复办法,保留原缺口开放状态。证据汇总落 track evidence 文件
  (Phase 8)。
- **升 P1 触发器**:G14 若复现阻断助手上下文,升 P1 处理(该文档原文)。

## 5. 非目标(Out of Scope)

- 不重开已修复项(请求预算 D72/别名缓存/lens 显式选择/空标题拦截/窄屏 B14/B15)。
- 不做全站术语替换、整体重设计或未经证据的错误修复。
- 不为与归档外观一致而给可逆且合同允许的动作加确认(A17 口径维持)。
- 不引入关键词路由、固定回答或事后删日志冒充助手认知(G10);不给历史记录补造
  PASS 或用今天字段值充当昨日前值(G03/G04)。
- 不做 per-app 授权治理、应用复活/重命名/归档分期(D71 非目标延续)。
- 不为截图工具伪影重构页面(B18)。
- 不新增每应用/每实体类型的按钮分支(I3);控件仍只来自当前 Siren 动作。
- 不改 T51/T52 已立的授权/停用合同本体;只修呈现、回执、证据时点与确认编排
  (G02 状态码分歧经裁定流程修订的除外)。
- 不把会话 ID 冒充消息 ID、不生成虚构来源(G07/G14)。

## 6. 规划期事实核查记录(2026-09-05,只读核查,HEAD d980f797)

前置:c9971648→d980f797 仅两个 docs 提交(ux-review 文档与截图),零代码漂移,
工作树干净。对该文档 10 项关键代码断言逐项核查,9 项成立、1 项部分成立:

1. **G01a 成立**:`confirmDeps` 只装配活跃业务定义(`apps/web/src/engine/service.ts:281-285`;
   `activeFlowList` 过滤 deprecated 条目,service.ts:262-267);meta 伪流(含
   APPLICATION_LIFECYCLE)不进该注册表,只在 meta 裁决/重放经 `withLifecycleFlows`
   注入(`packages/engine/src/definition/lifecycle.ts:176-184`、
   `meta.ts:255-262`)——严格策略下确认批准无宿主属实。
2. **G01b 成立**:`approveConfirmation` 仅以 `applyEffects(request, actionEffects(action))`
   重放目标动作效果,事件仅 `[confirmation-approved, action-executed]`
   (`packages/engine/src/execution/confirmation.ts:389-473`),不产
   application-deprecated 也不级联;现状被
   `application-deprecation.test.ts:276-313` 钉死(测试名即「确认链路只重放目标
   动作效果、不产 meta 伴随事件」,并断言 applications 表不变)。
3. **G02a 成立**:`scope_insufficient` 产生于 `apps/web/src/auth/application-scope.ts:45-53`,
   403 映射 `request-identity.ts:311-318`,实体 GET 接线 `api/entity/route.ts:74`;
   `deprecated-applications.contract.test.ts:192-218` 钉 403 口径——与 D71.3 文本
   (404)的分歧属实,Phase 0 裁定有真实输入。
4. **G02b 成立**:`meta-entity-page.tsx:41-50` 错误分支整树返回错误 Card,替换
   MetaEntityRenderer(各 renderer 承载 MetaActions);成功回执 `lastOutcome`/
   `lastDisclosure` 存于 `ScopedMetaActions` 的 useState
   (`renderers/common.tsx:90,118-129`),卸载即丢;`common.tsx:78` 的 key 含
   scope/rel,变化亦触发重挂载。
5. **G03 成立**:reason 三处持久化(`confirmation.ts:507-526`);
   `projectConfirmation` properties 含 target-rel/target-action/params/status 但
   **不含** rejectedReason,已决策确认不进 inbox(`contract/siren/project.ts:296-364`);
   确认卡绑定只有 label/status/detail/fields(`presentation/surface/generic.ts:279-297`;
   `apps/web/src/render/words/member-card.tsx:36-51`)——数据已在,呈现缺位属实。
6. **G05 成立(机制层面;根因仍待探针,与文档口径一致)**:唯一预填机制
   `action-group.tsx:56-59`(`prefill = entity.properties.fields`);实体页直传完整
   Siren 实体(`entity-view.tsx:371`),实例投影携带
   `fields: fieldValues(instance.fields)`(`project.ts:100-147`);工作区实体经 word
   binding 重建(`member-card.tsx:36-51`),fields 来自 surface 绑定
   `properties.fields` 的解引用(`generic.ts:286`)——surface 成员数据缺 fields
   时预填即空,丢失点候选即此。
7. **G07 成立**:`ObjectSelectorPanel`(`thread-desk-selector.tsx:32`)全库唯一
   消费点是书桌(`thread-desk.tsx:25,322`);首页为通用 surface 宿主
   (`app/page.tsx:16`),材料动作走通用合同表单(`generic.ts:221-222`),未复用
   选择器。
8. **G13 成立**:events API 已有 domain(枚举校验)/rel/kind/principal/游标
   (afterSeq/beforeSeq/order)合同(`api/events/route.ts:49-170`);UI 只请求
   `desc+limit+beforeSeq` 且注释明言无过滤控件(`app/events/page.tsx:27,95-105`)。
9. **G11 部分成立**:「历史状态像实时待办」成立——session-list 直接渲染
   `lastOutcome`,`OUTCOME_LABEL['suspended']='待确认'` 无历史语义标注
   (`session-list.tsx:15-20,68-72`;数据源 `chat/history.ts:150-158`);「预览无
   截断」**不成立**——`session-list.tsx:57` 已有 truncate class → §4 G11 收窄。
10. **G10 成立**:agent loop 每步重取当前实体与 sitemap 切片
    (`packages/agent/src/loop/loop.ts:252-253,279-285`),每轮把 catalog+entity
    全量拼进 user prompt(`llm/prompts.ts:67-113,173-213`);注释明示「Each
    decision discloses one freshly sanitized current entity, never old
    snapshots」——重复注入是**有意的新鲜度设计**,G10 修复面据此限定(§4)。

## 7. 执行期裁定点(预先声明,按需回写 plan/spec)

1. G02 裁定结果(Phase 0)→ 按 DECISIONS 流程落盘(修正实现或 D73 新决定)。
2. G01 详细设计与「无伴随事件」现状的规范地位(Phase 1 探针产出)→ 按需 DECISIONS。
3. G06 若执行期发现超出 remediation 边界(如需存量迁移),按 workflow
   「Task Correction」拆出后续 track,本 track 记录原因并收窄对应小故事范围。
4. G12/G14 定向复现失败时的处置:记录复现步骤与证据,缺口如实标注
   「未复现,保留开放」,不做无证据修复。

## 8. 全景验收走查(终验)

本地:逐缺口原故事浏览器复验(P1 缺口含 HTTP/授权/并发/重放对应证据;G10 含真实
LLM 评估)+ 全量门禁(`pnpm check` + `CI=true pnpm e2e` + `CI=true pnpm e2e
invariants`,G10 关联 `pnpm eval:llm`)。部署站:按 DEPLOYMENT 合同发布后对 P1
缺口与 G05/G07/G09 复验,部署 SHA/digest 记入 evidence;track 收口时若未发布,
按 T51/T52 先例记「待用户按 DEPLOYMENT 流程发布后执行」。
