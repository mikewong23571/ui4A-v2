# Walkthrough 用户故事（2026-08-22)

> 目的：按产品核心论题「同一场景，人类走 renderer、agent 走合同，同一份日志」体验应用，发现问题。
> 用法：逐个故事走查，标 ✅/⚠️/❌ + 一句话体感；问题按「故事号 + 现象 + 期待」记录，走查完按严重度归集立项。
> 环境：`PORT=3100 pnpm dev`(带 GLM_API_KEY);观察点 = 人工评估点（确认疲劳/澄清收敛/diff 可读性/凝固稳定性,GOAL.md)。
> 注意：走查会真实改写 dev 库（发布/下线/审核/批准）；需要复位时重跑 seed 或 TRUNCATE 后重启。

## 第一幕:业务平面——人和 agent 干同一件事

### US-1 人类发布文章(B1·renderer)

- 步骤:`/` → 点「文章发布向导」→ 三步表单逐字段填 → 发布 → 回首页。
- 预期:文章计数 2→3,新文章 `published`;发布后向导回到第一步(循环语义,D11)。
- 观察:表单字段与 schema 是否对得上人话?第三步正文有 draft 起草候选吗(proposal 来源的体验)?循环回第一步是否符合直觉?
- 结果:______

### US-2 agent 发布文章(B1·合同)

- 步骤:右下角聊天:「帮我发布一篇文章,标题《界面即合同读后感》,分类 tech」。
- 预期:逐步 step 帧(LLM 路径每步前有「思考 · 步骤 N」可展开)→ 发布成功;首页出现该文。
- 观察:每步 4–9s 的等待感如何?思考区内容对建立信任有帮助还是噪音?步骤文本是否看得懂 agent 在干嘛?
- 结果:______

### US-3 点名下线(B2)

- 步骤:聊天:「把 post-welcome 下线」。
- 预期:该篇 `offline`,另一篇不受影响。
- 观察:agent 是直接命中还是绕路?下线后列表/详情状态刷新是否及时(T12 缓存失效的体感)?
- 结果:______

### US-4 审核队列(B3)

- 步骤:聊天:「审核所有待处理评论」(或 UI 逐条点)。
- 预期:pending 清零,事件留痕。
- 观察:批量操作 agent 是逐条 exec 还是 plan 一次裁决?UI 路径下队列计数刷新是否顺?
- 结果:______

### US-5 失败呈现(B4/I1/I6)

- 步骤:聊天发个完不成的目标(如「删除所有文章」——无此动作)。
- 预期:如实 fail,说人话,不崩溃、不编造。
- 观察:失败原因可读吗?换个说法重试时 agent 有没有用上次的拒绝上下文(I6)?
- 结果:______

## 第二幕:裁决与信任

### US-6 高危动作确认门(S1)

- 步骤:聊天:「把 first-post 归档」→ 挂起(不生效)→ 首页收件箱出现确认 → 点进去看风险标注与原因 → 批准 → 生效。
- 预期:动作挂起为 pending 实体;human approve(actor=human)后生效;日志含 actor/principal/channel。
- 观察:**确认疲劳**——批准页给的信息够不够做决定?挂起原因是否人话?notify 送达延迟可接受吗?
- 结果:______

### US-7 审批不委托(I4)

- 步骤:聊天:「帮我批准刚才那个确认」。
- 预期:agent 身份 approve 被引擎拒绝(422 留痕),确认仍 pending。
- 观察:拒绝是否如实呈现,而非被 agent 粉饰?
- 结果:______

### US-8 plan-exec 一次决策(S4)

- 步骤:聊天:「把文章发布向导一次走完:填标题《批量测试》、分类 essay、正文随意,然后发布」。
- 预期:LLM 可能产出 exec-plan——一条批量裁决记录,多步一次决策完成。
- 观察:轨迹里每步裁决是否可见?与普通逐步 loop 的体感差异?
- 结果:______

## 第三幕:自举——系统改自己的定义

### US-9 agent 改 flow + 人类 BIOS 审批(S2,重头)

- 步骤:聊天:「给文章状态 flow 加一个置顶(pin)动作,发布后可置顶」→ agent 经 `_meta` revise → submit → 你去 `/meta/activations` → 点进详情:拓扑图 + 机械 diff + 八项不变式 checks → 批准 → 再回聊天「把 first-post 置顶」。
- 预期:activation pending → 批准后 sitemap 版本变;agent 零 prompt 改动直接用新动作。
- 观察:**diff 可读性**——拓扑图 + diff 一起够不够签字?app-known / capability-registered 两条新 checks 是否自解释?批准后 agent 无缝用新动作的「自举感」如何?
- 结果:______

### US-10 版本考古(T13)

- 步骤:`/meta/flow/article-drafting` 版本历史区:选 v1 × 当前版本对比。
- 预期:三视角 diff(added/deleted/updated)正确呈现历次变更。
- 观察:这个对比对「系统是数据」的叙事有说服力吗?缺什么(时间/作者/激活链接)?
- 结果:______

### US-11 capability 发现(T13)

- 步骤:`/meta/capabilities` 看 draft/notify/clarify 三能力详情。
- 预期:类别(extract/effect)、intent、input/output 可读。
- 观察:现在能回答「这个系统有哪些能力、各干什么」了吗?哪类能力的描述还太虚?
- 结果:______

## 第四幕:发现层与渲染

### US-12 应用分组发现(T10)

- 步骤:看 `/.well-known/ui4a.json` 的 applications 三组;聊天说「我想处理评论区的事」。
- 预期:rule 定位层命中 community intent → 组内入口优先(评论审核)。
- 观察:分组语义符合直觉吗?intent 文案对 agent 选路有区分度吗?
- 结果:______

### US-13 渲染两形态 + LLM 渲染(T12)

- 步骤:聊天依次:「展示文章列表」→「按分类展示文章」→「按分类可视化当前内容」(rule miss,LLM 产 spec)→ `/canvas` 看凝固结果。
- 预期:table → chart → LLM chart;同集合二次渲染更快(页面缓存);凝固事件留痕。
- 观察:**凝固稳定性**——刷新 `/canvas` 后渲染是否一致?LLM 产的 spec 与 rule 产的质量差距?
- 结果:______

### US-14 日志审计(双执行者同一日志)

- 步骤:`curl localhost:3100/api/events`(或 `| jq`)看本场足迹:human(表单)与 agent(chat)的 action-executed 并存、agent-decision 每步留痕(含 reasoning)、chat-turn、被拒事件带原因。
- 预期:同一份日志,两类 actor 足迹可辨、因果可追。
- 观察:能不能回答「这篇文章为什么是 archived」这类跨层因果?留痕太多还是太少?
- 结果:______

## 问题归集(walkthrough 后填)

| # | 故事号 | 现象 | 期待 | 严重度 | 去向(立项/跟进) |
|---|--------|------|------|--------|------------------|
| 1 | US-14 | 事件流不可读:`/events` 页(timeline 词条)逐条罗列原始字段(seq/kind/rel/action/actor)——无时间戳展示(ts 在投影时被丢弃)、无人类可读摘要、detail/reason 不呈现、kind/rel 是合同机器名未翻译;T11 后 chat-turn/agent-decision(含全量 prompt)混入,流更长更密。人类无法回答「发生了什么、为什么」,审计面失守(铁律 5 要求审计渲染零 AI,但零 AI ≠ 可读)。定位:`apps/web/src/render/situation.ts` eventsToMembers(只透传合同字段)、`apps/web/src/app/events/page.tsx`。 | 事件流对人类可读:每事件一条人类语言摘要(谁/在什么上/做了什么/结果与原因),带时间戳;按回合或实体分组折叠;detail/原文可下钻展开(合同原貌保留一层,不失审计性);全部机械渲染零 AI(铁律 5 不破)。 | 高(US-14 直接失守;「同一份日志」的双执行者叙事对人不可读) | 立项:事件流可读投影(机械叙事化,零 AI) |
| 2 | US-1 | 首页态势卡「在飞委托」是行话直译(in-flight delegation),用户不理解——实为「正在执行的 agent 委托任务数」(Temporal workflow running 计数,点击去 /delegations 舰队页)。定位:`apps/web/src/components/home-body.tsx:157` StatWord label;同卡「待确认」勉强可懂,但 stat 卡只有数字+标签,零上下文(是什么/为什么/点哪)。 | 用用户语言(如「执行中委托」「进行中的委托任务」);stat 卡给一层含义说明(title/tooltip 或副标题);整站词汇(委托/舰队/收件箱/态势)做一次 UX 文案走查,统一人话口径。 | 中(首页第一屏即劝退;词不达意影响整站信任) | 跟进:整站文案人话化(可与事件流可读投影合并立项) |
| 3 | US-1 | 向导页「title 有两个 label」:属性表把节点 title(基本信息)以属性名 `title` 原样投影,与同屏 RJSF 表单字段 `title`(文章标题)撞名——一个是展示标题、一个是数据字段,用户无法区分。根因:renderer 把实体 properties 的机器字段名直接当 label 渲染(同 #1/#2 的「不是人话」同源)。定位:entity-view 属性表渲染 + flow 定义节点 title 投影。 | 属性表 label 人话化(或隐藏纯展示性 title 属性);表单字段 label 用语义标题(如「文章标题」——field-definition 有 title 字段可用,flow seed 里没填);机器名永不直接上屏。 | 中(表单是最核心交互面,首步即混淆) | 跟进:并入人话化 track(field title 人话 + 属性表投影过滤) |
| 4 | US-1 | 向导最后一步(ready)发布表单又要求输入 title——第一步已填过,无任何解释为何再要。根因:publish 动作声明 `fields: [title required]`(append 效果 `name-from: title` 需要参数;flows.ts:84 注释自知「向导前序步骤的字段已落在实例上」),但表单既不预填实例上已有的 title,也不说明「此 title 用于生成文章地址 slug」。 | 动作字段与实例字段同名时默认预填(context 来源),让用户确认而非重输;表单字段加说明(description:「用于生成文章地址,与前序所填一致」);或定义层支持 name-from 直接读实例字段免采集。 | 中(向导收尾处的信任折损:「系统是不是把我填的弄丢了?」) | 跟进:exec 表单实例字段预填 + 字段说明人话化(同人话化 track) |
| 5 | US-1 | **数据丢失 bug(非文案)**:向导第二步选的 category/tags 发布后在文章上完全消失——实证 `post:walkthrough` 实体 fields 只有 `{"title": "walkthrough 初体验"}`,无 category(seed 文章有)。根因:`effects.ts` append 效果的 `paramsToFields(request, effect.fields)` **只复制本次 exec 请求参数**;publish 动作只声明 title 字段,分类步收集的 category/tags 经 set-field 落在向导实例(article-drafting:main)上,append 不从源实例字段取值。e2e 断言缺口:B1 各测试只断言文章出现与状态,从未断言 category/tags 落在新文章上,所以一直绿。 | append 效果合并源实例字段(参数优先、实例字段兜底,origin 各自留痕,不破铁律 4);或定义层声明字段映射。修后补 e2e 断言:发布文章的 category/tags 与向导所填一致。 | **高**(B1 主链路静默丢数据;「事实永不发明」的对偶——事实被静默丢弃) | 立项:append 效果源实例字段合并 + B1 断言补强(与 #4 的预填方案一并设计) |
| 6 | US-2/US-13 | **#5 的下游爆点 + 画布韧性缺口**:chat 发布(US-2)同路径丢 category(实证同一 append 机制,agent/人类两路都中);随后 `/canvas` 上 S5 时代凝固的 articles-by-category chart 对**每个成员**解引用 `fields.category`,撞上无该字段的成员 → deref 闸(I2 缺数据不造数据)**整面响亮失败**:「bind.series 维度路径 "fields.category" 在成员 #2(post:walkthrough)上不存在」。闸的行为正确(拒绝发明数据),但:①一个成员缺字段 → 整个 surface 挂掉,错误文案面向开发者而非用户;②与 T12 遗留 bug(非聚合词条 dimension 错位/caption dangling/无 per-surface 错误边界)同族——现已从「实测发现」升级为「walkthrough 实锤」。 | 根因修 #5 即解;韧性另立:deref 成员级失败降级为「该成员跳过 + 面内如实标注」(或直接失败但 per-surface 错误边界,一个面挂不拖死整页);错误文案给用户行动指引(哪条数据缺什么、去哪修)。 | **高**(画布在主路径上直接不可用;且证明凝固 spec 对数据漂移零韧性) | 立项:画布 deref 韧性与错误边界(与 T12 遗留三 bug 并案;根因依赖 #5) |
