# T14 walkthrough 修复:数据契约 + 画布韧性 + 人类可读性 — Spec

> Track ID: `t14-walkthrough-remediation_20260822` · Type: Bug fix · 状态: approved(用户指示「统一修复现有问题」;编排 agent 代行验收)
> 上下文:`conductor/walkthrough-20260822.md` 问题归集 #1–#7(全部定位与实证);`packages/engine/src/effects.ts`(append/paramsToFields)、`apps/web/src/render/deref.ts`(解引用闸)、`apps/web/src/components/canvas-body.tsx`(planSurface/错误呈现)、`apps/web/src/render/situation.ts`(eventsToMembers)、`apps/web/src/components/entity-view.tsx`(属性表/动作表单);T12 遗留渲染三 bug(da1b6c9 note)。

## Overview

walkthrough(2026-08-22,14 则用户故事)暴露七条问题,归为一条主线三个面:

1. **数据契约(#4/#5,高)**:向导分类步收集的 category/tags 经 set-field 落在向导实例上,而 publish 的 append 效果只复制本次 exec 请求参数(`paramsToFields`)——发布文章静默丢失向导所填字段(实证 `post:walkthrough` 无 category),且 publish 表单重复索要 title 不预填不解释。B1 全套 e2e 从未断言新文章字段保真,bug 一直绿。
2. **画布韧性(#6/#7,高)**:凝固 spec 对成员级数据漂移零韧性——一个成员缺字段,deref 整面响亮失败且每次重载必现(用户感知为「卡死」);合同无任何数据修复通道(无 remove/订正动作);T12 遗留同族 bug(非聚合词条 dimension 错位、caption dangling、无 per-surface 错误边界)。
3. **人类可读性(#1/#2/#3,中)**:事件流逐条罗列机器字段(无时间戳/无摘要/detail 不呈现);「在飞委托」等行话上屏;属性表把机器字段名当 label 与表单字段撞名。系统一切都在,但都不是人话。

## 架构决定

1. **append 效果合并源实例字段(修 #5,引擎语义变更,先记 DECISIONS)**:`paramsToFields` 现行语义(只取请求参数)改为「**请求参数优先,源实例字段兜底合并**」——append 的新实体字段 = 源实例 fields ∪ 请求参数(参数覆盖同名字段),每个字段保留各自 origin(铁律 4 不破:值都有出处);`fields` 白名单语义不变(声明则从合并集取白名单)。这是机制层正解:「向导收集 → 后续动作消费」的自然写法天然正确,新建 flow 不再踩坑。I5 重放口径:fold 消费实体快照/事件载荷,引擎在线语义变更不影响既有日志重放(重放测试验证)。
2. **exec 表单实例字段预填(修 #4,renderer 侧)**:动作字段与当前实体 fields 同名时,RJSF 表单以实例值预填(defaultValue),用户确认而非重输;publish 的 title 字段补 description(「用于生成文章地址 slug,与前序所填一致」)。字段 label 优先取 field-definition 的 `title`(seed 同步补人话标题),机器名不直接上屏(修 #3 的表单侧)。
3. **画布韧性(修 #6/#7 + T12 遗留)**:
   - deref 成员级降级:集合成员缺字段时该成员**跳过并计数**,surface 内如实标注「N 条成员因缺字段 X 未纳入」(零发明——不造值,只豁免并声明);整面失败保留给结构性错误(裸字面/实体不存在);
   - per-surface 错误边界:单个 surface 渲染期抛错不拖死整页,错误呈现在该 surface 槽位(修 T12 遗留无边界);
   - caption 字段引用可解析性纳入 grounding 核对(renderSpecGroundingErrors 增 caption 校验;T12 遗留 #2);
   - 非聚合词条 bindSchema 禁 dimension(kanban/table/timeline 的 collectionNode 去掉可选 dimension,与运行时 asMembers 对齐;T12 遗留 #1);
   - 错误文案给行动指引(哪条数据缺什么)。
4. **事件流可读投影(修 #1,零 AI,铁律 5 不破)**:`/events` 页每事件一条**机械叙事摘要**——按 kind 的模板生成「谁 · 在什么上 · 做了什么 · 结果/原因」(kind 注册表驱动,未知 kind 回退原始字段行);时间戳展示;detail/reason 折叠可下钻(原文保留一层,审计性不失);chat-turn/agent-decision 默认折叠为一行(回合级),可展开看 steps/五要素。全部机械渲染,不引任何 LLM。
5. **文案人话化(修 #2)**:首页 stat 卡「在飞委托」→「执行中委托」并加说明副标题;整站词汇走查一并处理(委托/收件箱/态势/舰队在导航与标题的口径);属性表 label 人话化或过滤纯展示字段(修 #3 的属性表侧)。
6. **B1 断言补强**:e2e 补「发布文章的 category/tags 与向导所填一致」(agent 路径 + human 路径),防止此类回归再度隐身。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有零回归 + 新增);
2. #5:向导所填 category/tags 出现在发布文章实体上(e2e 断言,agent/human 两路);origin 留痕(实例字段 origin 与参数 origin 可辨);I5 重放一致;
3. #4:publish 表单 title 预填实例值(组件测试);#3:表单 label 取 field title、属性表机器名不上屏(组件测试);
4. #6:缺字段成员被跳过并计数标注,chart 其余成员正常渲染(测试);单 surface 抛错不拖死整页(组件测试);caption dangling 被 grounding 拒(测试);非聚合词条 dimension 被 bindSchema 拒(测试);
5. #1:/events 每事件有摘要行 + 时间戳,detail 可折叠下钻(组件测试);零 AI 源级断言通过;
6. #2:stat 卡新文案 + 说明(组件测试);导航词汇一致;
7. 回归:B1–B4 / S1–S5 / I1–I6 既有断言零改动通过(允许的机械适配需逐一记录);
8. walkthrough 复验:dev 库重置后重走 US-1/US-2/US-13/US-14,问题 #1–#7 全部闭环(脚本化 + 人工确认点)。

## Out of Scope(非目标)

- 数据订正/移除类合同动作(#7 的「合同无自救通道」架构 backlog,单独评估);
- LLM render 凝固复用短路(T12 遗留 #3,优化项);
- capability-schema-compatible(D23 已记归后续);
- D19 路线剩余棒次(/app/<name>、角色 archetype);
- 流程模拟器(定义即数据的通用 happy-path 遍历,之前讨论的第四道防线——若 Phase A 余量允许单独立项,本 track 不含)。

## 施工上下文(自包含:subagent 无需再做 discovery)

**模块地图(精确触点)**:

- append 语义:`packages/engine/src/effects.ts`(paramsToFields :136、append 分支 :248 附近);流实例字段来源:`packages/engine/src/types.ts`/state.ts(InstanceState fields);I5 测试形态:`apps/web/src/engine/service.definitions.test.ts`、`apps/web/src/db/replay.test.ts`。
- 表单:`apps/web/src/components/action-runner.tsx`(RJSF 渲染,字段集由合同声明)、`apps/web/src/components/entity-view.tsx`(属性表);seed 字段标题:`apps/web/src/domain/flows.ts`。
- deref/画布:`apps/web/src/render/deref.ts`(集合成员解引用与 DimensionCount)、`apps/web/src/components/canvas-body.tsx`(planSurface 循环 :176-195、canvas-errors 呈现 :241)、`apps/web/src/render/words/*.tsx`(chart/table 等);grounding:`packages/agent/src/render.ts` renderSpecGroundingErrors;bindSchema:`apps/web/src/render/registry.ts`。
- 事件流:`apps/web/src/app/events/page.tsx`、`apps/web/src/render/situation.ts`(eventsToMembers :57)、`apps/web/src/render/words/timeline.tsx`;kind 清单:`packages/engine/src/fold.ts` LogEventKind。
- 首页 stat:`apps/web/src/components/home-body.tsx:157`;导航:`apps/web/src/components/`(SiteNav)。

**既有断言红线**:I2 事实不可发明——降级是「跳过+声明」不是造值;铁律 5 审计渲染零 AI——事件摘要为机械模板,源级断言名单同步;I5 重放同构;B1–B4/S1–S5/I1–I6 断言零改动(#6 的 B1 断言补强是新增不是修改)。

**基础设施与命令**:PG `docker compose up -d --wait`(宿主 5433);`CI=true pnpm check`;e2e `CI=true pnpm e2e`(3100,D5)。**改 apps/web 前必读 `apps/web/AGENTS.md`**。actor/principal 自报口径(D8)。
