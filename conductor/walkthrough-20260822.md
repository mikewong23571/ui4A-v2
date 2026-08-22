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
- 结果:通过。renderer 四步发布后文章保留 title/category/tags/body；发布后向导回到 basic-info，字段已清空，放弃动作不再重复采集 title。

### US-2 agent 发布文章(B1·合同)

- 步骤:右下角聊天:「帮我发布一篇文章,标题《界面即合同读后感》,分类 tech」。
- 预期:逐步 step 帧(LLM 路径每步前有「思考 · 步骤 N」可展开)→ 发布成功;首页出现该文。
- 观察:每步 4–9s 的等待感如何?思考区内容对建立信任有帮助还是噪音?步骤文本是否看得懂 agent 在干嘛?
- 结果:通过。真实 LLM 从发布入口完成 next×3 + publish；画布随成功动作刷新，新增文章没有继承上一轮人类 tags。

### US-3 点名下线(B2)

- 步骤:聊天:「把 post-welcome 下线」。
- 预期:该篇 `offline`,另一篇不受影响。
- 观察:agent 是直接命中还是绕路?下线后列表/详情状态刷新是否及时(T12 缓存失效的体感)?
- 结果:通过。点名 `post-welcome` 后执行 unpublish，聊天与共享画布同步显示 offline。

### US-4 审核队列(B3)

- 步骤:聊天:「审核所有待处理评论」(或 UI 逐条点)。
- 预期:pending 清零,事件留痕。
- 观察:批量操作 agent 是逐条 exec 还是 plan 一次裁决?UI 路径下队列计数刷新是否顺?
- 结果:通过但发现并修复歧义授权缺口。明确“审核所有待处理评论”可逐条处理；“我想处理评论区的事”现在只定位 comments，不再擅自通过评论。

### US-5 失败呈现(B4/I1/I6)

- 步骤:聊天发个完不成的目标(如「删除所有文章」——无此动作)。
- 预期:如实 fail,说人话,不崩溃、不编造。
- 观察:失败原因可读吗?换个说法重试时 agent 有没有用上次的拒绝上下文(I6)?
- 结果:通过。删除目标在 4 步内以 fail 明确报告合同无 delete capability，文章零删除、零替代性下线/归档。

## 第二幕:裁决与信任

### US-6 高危动作确认门(S1)

- 步骤:聊天:「把 first-post 归档」→ 挂起(不生效)→ 首页收件箱出现确认 → 点进去看风险标注与原因 → 批准 → 生效。
- 预期:动作挂起为 pending 实体;human approve(actor=human)后生效;日志含 actor/principal/channel。
- 观察:**确认疲劳**——批准页给的信息够不够做决定?挂起原因是否人话?notify 送达延迟可接受吗?
- 结果:通过。archive 仅生成一条 confirmation 并以 suspended 终止，不再把 HTTP 202 当拒绝重试。

### US-7 审批不委托(I4)

- 步骤:聊天:「帮我批准刚才那个确认」。
- 预期:agent 身份 approve 被引擎拒绝(422 留痕),确认仍 pending。
- 观察:拒绝是否如实呈现,而非被 agent 粉饰?
- 结果:通过。agent 从 inbox 定位 confirmation 后因 actor-is-human 在工具投影阶段止步；人类审批页显示目标、风险、策略与原因，批准后动作消失且状态 approved。

### US-8 plan-exec 一次决策(S4)

- 步骤:聊天:「把文章发布向导一次走完:填标题《批量测试》、分类 essay、正文随意,然后发布」。
- 预期:LLM 可能产出 exec-plan——一条批量裁决记录,多步一次决策完成。
- 观察:轨迹里每步裁决是否可见?与普通逐步 loop 的体感差异?
- 结果:通过（含一次拒绝即数据修复）。真实 LLM 使用 exec-plan；首轮字段名猜错后前序步骤按 append-only 语义保留，HTTP 客户端现把具体失败步报告回流，续步发布成功；`plan-executed` 逐步摘要可审计。

## 第三幕:自举——系统改自己的定义

### US-9 agent 改 flow + 人类 BIOS 审批(S2,重头)

- 步骤:聊天:「给文章状态 flow 加一个置顶(pin)动作,发布后可置顶」→ agent 经 `_meta` revise → submit → 你去 `/meta/activations` → 点进详情:拓扑图 + 机械 diff + 八项不变式 checks → 批准 → 验证存量 `first-post` 仍按出生版本 v1 不出现 pin；再发布 v2 文章并聊天置顶。
- 预期:activation pending → 批准后 sitemap 版本变;agent 零 prompt 改动直接用新动作。
- 观察:**diff 可读性**——拓扑图 + diff 一起够不够签字?app-known / capability-registered 两条新 checks 是否自解释?批准后 agent 无缝用新动作的「自举感」如何?
- 结果:通过。agent 从 meta sitemap 精确定位 post-status，revise/add-action/submit 全走合同；人类批准 a1 后 sitemap 变为 v2。存量 first-post 诚实保持 v1，新生 after-v2 无 prompt 改动即发现并执行 pin，`pinned=true`。

### US-10 版本考古(T13)

- 步骤:`/meta/flow/article-drafting` 版本历史区:选 v1 × 当前版本对比。
- 预期:三视角 diff(added/deleted/updated)正确呈现历次变更。
- 观察:这个对比对「系统是数据」的叙事有说服力吗?缺什么(时间/作者/激活链接)?
- 结果:通过。版本历史显示 v1 superseded、v2 active、激活作者与 a1；v1→v2 对比准确列出 pin 的 7 条 added 变更。

### US-11 capability 发现(T13)

- 步骤:`/meta/capabilities` 看 draft/notify/clarify 三能力详情。
- 预期:类别(extract/effect)、intent、input/output 可读。
- 观察:现在能回答「这个系统有哪些能力、各干什么」了吗?哪类能力的描述还太虚?
- 结果:通过。draft/notify/clarify 三项均显示 kind、intent；目录已能回答能力清单与用途，input/output 仍可在详情页下钻。

## 第四幕:发现层与渲染

### US-12 应用分组发现(T10)

- 步骤:看 `/.well-known/ui4a.json` 的 applications 三组;聊天说「我想处理评论区的事」。
- 预期:rule 定位层命中 community intent → 组内入口优先(评论审核)。
- 观察:分组语义符合直觉吗?intent 文案对 agent 选路有区分度吗?
- 结果:通过。sitemap 显示 default/publishing/community 三组；“我想处理评论区的事”命中 comments 入口并明确“未执行具体动作”。

### US-13 渲染两形态 + LLM 渲染(T12)

- 步骤:聊天依次:「展示文章列表」→「按分类展示文章」→「按分类可视化当前内容」(rule miss,LLM 产 spec)→ `/canvas` 看凝固结果。
- 预期:table → chart → LLM chart;同集合二次渲染更快(页面缓存);凝固事件留痕。
- 观察:**凝固稳定性**——刷新 `/canvas` 后渲染是否一致?LLM 产的 spec 与 rule 产的质量差距?
- 结果:通过。table=`articles-list`、rule chart=`articles-by-category`、LLM chart=`content-by-category` 均凝固；刷新后两张 chart 稳定复现、无 surface 错误，table 含 body。

### US-14 日志审计(双执行者同一日志)

- 步骤:`curl localhost:3100/api/events`(或 `| jq`)看本场足迹:human(表单)与 agent(chat)的 action-executed 并存、agent-decision 每步留痕(含 reasoning)、chat-turn、被拒事件带原因。
- 预期:同一份日志,两类 actor 足迹可辨、因果可追。
- 观察:能不能回答「这篇文章为什么是 archived」这类跨层因果?留痕太多还是太少?
- 结果:通过。原始日志与 `/events` 机械投影可区分 human/agent，覆盖 action-executed、action-rejected(reason/detail)、agent-decision(reasoning)、chat-turn、definition-activated、render-spec-frozen 与 plan-executed；因果可由 confirmation/activation/turn rel 串联。

## 问题归集(walkthrough 后填)

| # | 故事号 | 现象 | 期待 | 严重度 | 去向(立项/跟进) |
|---|--------|------|------|--------|------------------|
| 1 | US-14 | 事件流不可读:`/events` 页(timeline 词条)逐条罗列原始字段(seq/kind/rel/action/actor)——无时间戳展示(ts 在投影时被丢弃)、无人类可读摘要、detail/reason 不呈现、kind/rel 是合同机器名未翻译;T11 后 chat-turn/agent-decision(含全量 prompt)混入,流更长更密。人类无法回答「发生了什么、为什么」,审计面失守(铁律 5 要求审计渲染零 AI,但零 AI ≠ 可读)。定位:`apps/web/src/render/situation.ts` eventsToMembers(只透传合同字段)、`apps/web/src/app/events/page.tsx`。 | 事件流对人类可读:每事件一条人类语言摘要(谁/在什么上/做了什么/结果与原因),带时间戳;按回合或实体分组折叠;detail/原文可下钻展开(合同原貌保留一层,不失审计性);全部机械渲染零 AI(铁律 5 不破)。 | 高(US-14 直接失守;「同一份日志」的双执行者叙事对人不可读) | 立项:事件流可读投影(机械叙事化,零 AI) |
| 2 | US-1 | 首页态势卡「在飞委托」是行话直译(in-flight delegation),用户不理解——实为「正在执行的 agent 委托任务数」(Temporal workflow running 计数,点击去 /delegations 舰队页)。定位:`apps/web/src/components/home-body.tsx:157` StatWord label;同卡「待确认」勉强可懂,但 stat 卡只有数字+标签,零上下文(是什么/为什么/点哪)。 | 用用户语言(如「执行中委托」「进行中的委托任务」);stat 卡给一层含义说明(title/tooltip 或副标题);整站词汇(委托/舰队/收件箱/态势)做一次 UX 文案走查,统一人话口径。 | 中(首页第一屏即劝退;词不达意影响整站信任) | 跟进:整站文案人话化(可与事件流可读投影合并立项) |
| 3 | US-1 | 向导页「title 有两个 label」:属性表把节点 title(基本信息)以属性名 `title` 原样投影,与同屏 RJSF 表单字段 `title`(文章标题)撞名——一个是展示标题、一个是数据字段,用户无法区分。根因:renderer 把实体 properties 的机器字段名直接当 label 渲染(同 #1/#2 的「不是人话」同源)。定位:entity-view 属性表渲染 + flow 定义节点 title 投影。 | 属性表 label 人话化(或隐藏纯展示性 title 属性);表单字段 label 用语义标题(如「文章标题」——field-definition 有 title 字段可用,flow seed 里没填);机器名永不直接上屏。 | 中(表单是最核心交互面,首步即混淆) | 跟进:并入人话化 track(field title 人话 + 属性表投影过滤) |
| 4 | US-1 | 向导最后一步(ready)发布表单又要求输入 title——第一步已填过,无任何解释为何再要。根因:publish 动作声明 `fields: [title required]`(append 效果 `name-from: title` 需要参数;flows.ts:84 注释自知「向导前序步骤的字段已落在实例上」),但表单既不预填实例上已有的 title,也不说明「此 title 用于生成文章地址 slug」。 | 动作字段与实例字段同名时默认预填(context 来源),让用户确认而非重输;表单字段加说明(description:「用于生成文章地址,与前序所填一致」);或定义层支持 name-from 直接读实例字段免采集。 | 中(向导收尾处的信任折损:「系统是不是把我填的弄丢了?」) | 跟进:exec 表单实例字段预填 + 字段说明人话化(同人话化 track) |
| 5 | US-1 | **数据丢失 bug(非文案)**:向导第二步选的 category/tags 发布后在文章上完全消失——实证 `post:walkthrough` 实体 fields 只有 `{"title": "walkthrough 初体验"}`,无 category(seed 文章有)。根因:`effects.ts` append 效果的 `paramsToFields(request, effect.fields)` **只复制本次 exec 请求参数**;publish 动作只声明 title 字段,分类步收集的 category/tags 经 set-field 落在向导实例(article-drafting:main)上,append 不从源实例字段取值。e2e 断言缺口:B1 各测试只断言文章出现与状态,从未断言 category/tags 落在新文章上,所以一直绿。 | append 效果合并源实例字段(参数优先、实例字段兜底,origin 各自留痕,不破铁律 4);或定义层声明字段映射。修后补 e2e 断言:发布文章的 category/tags 与向导所填一致。 | **高**(B1 主链路静默丢数据;「事实永不发明」的对偶——事实被静默丢弃) | 立项:append 效果源实例字段合并 + B1 断言补强(与 #4 的预填方案一并设计) |
| 6 | US-2/US-13 | **#5 的下游爆点 + 画布韧性缺口**:chat 发布(US-2)同路径丢 category(实证同一 append 机制,agent/人类两路都中);随后 `/canvas` 上 S5 时代凝固的 articles-by-category chart 对**每个成员**解引用 `fields.category`,撞上无该字段的成员 → deref 闸(I2 缺数据不造数据)**整面响亮失败**:「bind.series 维度路径 "fields.category" 在成员 #2(post:walkthrough)上不存在」。闸的行为正确(拒绝发明数据),但:①一个成员缺字段 → 整个 surface 挂掉,错误文案面向开发者而非用户;②与 T12 遗留 bug(非聚合词条 dimension 错位/caption dangling/无 per-surface 错误边界)同族——现已从「实测发现」升级为「walkthrough 实锤」。 | 根因修 #5 即解;韧性另立:deref 成员级失败降级为「该成员跳过 + 面内如实标注」(或直接失败但 per-surface 错误边界,一个面挂不拖死整页);错误文案给用户行动指引(哪条数据缺什么、去哪修)。 | **高**(画布在主路径上直接不可用;且证明凝固 spec 对数据漂移零韧性) | 立项:画布 deref 韧性与错误边界(与 T12 遗留三 bug 并案;根因依赖 #5) |
| 7 | US-13 | **合同无数据修复通道 + 「假卡死」体验**:探针实测 /canvas 页面本身响应正常(headless Chromium + CDP,evalRTT 1-3ms,零页面错误,聊天面板在画布页使用亦不卡)——用户感知的「卡死」实为 chart surface 每轮重载必失败的卡死感(「重新载入」治不了数据病)。且 unpublish 不能救:成员仍在 articles 集合中(offline 不移除成员),deref 依旧踩缺字段成员。即:合同里没有任何动作能修复/移除一条坏数据(无 remove、无字段订正、archive 也不移集合),画布被一条坏成员永久劫持,除非 DB 重置或 #6 韧性落地。 | 短期:per-member 降级(#6)让画布对坏成员免疫;中期:flow 定义层补「数据订正」类动作先例(或集合成员的 remove 语义);认知:「重新载入」按钮在错误持续存在时应如实表达「问题不在加载,在数据」。 | 高(用户把数据病误诊为系统卡死,信任折损大;且暴露合同无自救通道) | 并入 #6 画布韧性 track(错误态表达 + per-member 降级);数据订正动作另记架构 backlog |

## T14 修复复验（2026-08-22）

以 `e2e/t14-walkthrough.spec.ts` 在重置后的 dev 库脚本化复走 US-1 / US-2 / US-13 / US-14；同一场景内先由 renderer 发布、再由 chat 合同发布，随后验证 table/chart 凝固与 `/events` 共享审计日志。结果：

| 问题 | 复验结果 |
|---|---|
| #1 | `/events` 每条均显示机械摘要与时间戳；原始 audit 默认折叠且可展开；human/agent/chat-turn/agent-decision 均可辨。 |
| #2 | 首页采用「运行概览」「执行中委托」「委托监控」「定义管理」，执行中委托带口径说明。 |
| #3 | 向导表单使用「文章标题」等 field title，属性表不再把纯展示机器字段与表单撞名。 |
| #4 | ready 页 title 自动预填前序值，并说明其 slug 用途；无需重复输入即可发布。 |
| #5 | human/agent 两路发布后的文章均保留 category/tags；append 来源与重放回归通过。 |
| #6 | 缺字段成员改为跳过并面内声明，结构错误与渲染异常按 surface 隔离；caption/dimension 双闸通过针对性回归。 |
| #7 | 坏成员不再永久劫持整张画布，重载保持其余数据稳定；通用数据订正/remove 动作仍按原 spec 作为独立架构 backlog，不伪装为本 track 已提供。 |

验收证据：`CI=true pnpm check`（118 files / 1095 tests）；`CI=true pnpm e2e`（46 passed / 4 gated skips）；T14 walkthrough 场景 1/1；真实 GLM 的 rule-miss「按分类可视化当前内容」路径 1/1，通过 grounding/bind 闸后凝固并在画布渲染。

## T14 之后补充问题：单实体阅读闭环缺失（#8）

用户输入「我要看看第一篇文章」时，agent 返回 `articles-list` 并跳到集合表格，而不是定位 `post:first-post` 并打开一篇具体文章。这不是 `body` 字段缺失问题，而是**用户意图没有完成闭环**：展示意图路由把「文章」识别为集合，把「第一篇」忽略；聊天输入也没有提取标题/序号或实体 rel。当前系统已有 `/entity?rel=…` 实体页与 `detail` 词条，但自然语言查看路径没有把二者接起来。

期望的产品行为是：

```text
「我要看看第一篇文章」
→ 从 articles 集合解析目标实体
→ 进入具体文章阅读/详情视图
→ 展示该实体已有事实；缺失内容也明确呈现，不阻断查看
```

文章正文只是详情视图中的一个内容部分，不应成为路由正确性的前置条件。该问题超出 T14 #1–#7 的验收范围，单独作为“单实体导航 + 业务对象阅读视图”能力立项；不要以补 seed 字段或继续强化集合 table 作为替代修复。

## T14 之后补充问题：合同外目标无法如实终止（#9）

用户输入「删除所有文章」时，`articles` 集合与各 `post:*` 实体均未声明 delete/remove 动作；这本应是合同给出的确定结论。但 LLM agent 在 `articles ↔ post:*` 之间反复导航，客户端在 120 秒总时限到达后取消了本地读流。这个现象不能证明 SSE 已失活或服务端已超时（见 #10）；本问题在于**合同明确表达“不具备该能力”后，agent 却没有合法、及时的失败出口**。

当前协议只向模型投影 `navigate / exec / clarify / render / done`：`clarify`、`render` 被标记为禁止调用，`done` 又只允许目标成功后调用；内部虽支持 `AgentOperation.fail`，工具协议却没有 `fail` 动词。因此当当前及可达实体都没有目标动作时，模型只能继续导航或发出非法调用。循环运行时也只有 `maxSteps` 总上限，没有对重复 `(goal, rel, actions)` 状态的停滞检测。

期望行为：

```text
「删除所有文章」
→ 检查当前及可达合同没有 delete/remove 动作
→ 以 failed 终态立即结束
→ 明确说明「合同未声明删除文章能力，未执行任何修改」
→ 可列出已声明的下线/归档等替代能力，但未经用户授权不得代为执行
```

修复应同时覆盖：协议级显式 `fail(reason, evidence)` 终止动词；机械的无能力/重复状态停滞检测；failed/chat-turn 审计留痕；零 key 的 rule 路径与 LLM 路径同口径。新增验收场景应断言合同外目标在有限步内诚实失败、零副作用、零循环导航，而不是仅缩短客户端 timeout。该问题属于“合同即能力边界”的核心主张，严重度高，建议与 #8 一起作为 agent 读/失败闭环的新 track 输入。

## T14 之后补充问题：SSE 活跃流被固定总时限误判（#10）

聊天客户端在发送请求前创建 `timeoutSignal(120_000)`，并把它与人工停止 signal 合并。该计时器是从请求开始计算的**固定 wall-clock deadline**，不会在收到 `thinking-delta`、`thinking` 或 `step` 帧时重置。到达 120 秒后，`readChatSseStream` 无条件 cancel reader 并抛出 `TimeoutError`。因此 UI 文案「请求超时(120s 未收到完整响应)」只表示“120 秒内没有收到 final 帧”，不表示“120 秒没有任何响应”，更不能证明模型或服务端已经停止工作。

服务端的 SSE 包装在客户端断开后只停止 enqueue，agent loop 仍继续执行并在结束后写入 `agent-decision/chat-turn`。这会形成三个不同状态：流仍有进展、客户端停止等待、服务端继续运行；当前 UI 把它们压成一个“失败:请求超时”，语义不准确。

正确的流式生命周期应分开建模：

- **空闲超时**：只在连续一段时间没有任何有效帧/heartbeat 时触发，每帧到达即续期；
- **总时限**：若产品确实需要，应作为独立的最大观察时长，文案说明“停止等待，服务端仍可能继续”，不能称为流失活；
- **任务状态**：客户端停止消费后仍可按 session/委托 ID 查询最终结果，避免已产生的轨迹与 UI 结论分叉；
- **服务端静默期**：模型端暂时没有 token 时由 heartbeat 维持连接活性，但 heartbeat 不冒充业务进展。

新增验收应覆盖：活跃 SSE 持续超过 120 秒但周期性有帧时不被空闲超时中断；真正静默超过阈值才触发 idle timeout；总时限与人工停止使用不同文案；断流后最终结果可恢复。#9 的失败出口仍需修复，但不能用当前 120 秒客户端 deadline 证明 agent 已经“超时”。

## T14 之后补充问题：agent 当前处境未投影到共享画布（#11）

聊天执行过程中，agent 的每次成功 `navigate` 已通过 SSE `step` 帧携带当前 `rel`，但客户端只把该值保存为聊天消息 metadata，并且只在少数 flow 步骤上显示一个弱化徽章。主内容区与画布不消费这个导航状态；画布自动跳转只响应最终的 render 回执。因此 agent 虽然在合同图中从 `articles` 导航到各 `post:*`，人类看到的共享界面始终停留在旧内容，无法观察“模型此刻正在看什么”。

这是“同一场景，人类走 renderer、agent 走合同”的核心断裂：合同导航存在、文字轨迹存在，但 agent 的当前处境没有成为 renderer 的可见状态。它不应被归为聊天文案或调试日志问题，也不应要求模型每一步额外生成 render spec。

期望行为：

```text
agent navigate → post:first-post
→ SSE 发布成功导航后的 focus(rel)
→ 共享画布用 binding-only detail 从该 rel 解引用
→ 人类立即看到 agent 当前查看的业务对象
```

这里的 `focus` 是临时处境，不是凝固布局：不产生 `render-spec-frozen`，不把实体内容塞进 SSE，只传实体引用；renderer 继续从合同端点/实体缓存取事实。快速连续导航应更新同一个 focus surface，而不是为每一步新增画布卡片。人类主动点选实体也应写入同一套 focus 模型，保证双方共享一个“当前对象”。可以提供暂停跟随，但默认跟随正在执行的 inline agent。

新增验收应覆盖：每个成功 navigate 帧后画布在有限延迟内显示对应实体；exec/done 不误切 focus；显示值与 `/api/entity?rel=…` 快照一致；导航循环在人类界面上可观察；focus 更新零业务副作用、零凝固事件。严重度高，建议与 #8（单实体阅读）、#9（失败出口）、#10（SSE 生命周期）合并为“agent 处境与人类界面闭环”新 track。

## T14 之后补充问题：业务应用仍由 TS 特权出生（#12）

`flows.ts`、`applications.ts`、`capabilities.ts` 与 `seed.ts` 仍编译进 article/
publishing/community 的完整业务定义。boot 虽把全文写入日志、日常运行优先使用活跃
定义，但 `service.ts` 仍负责枚举这些常量、在空库逐条 append，并在定义缺失时回退
代码常量。因此当前只做到“启动后应用是数据”，没有做到“应用从安装开始就是数据”。

期望：TS 只保留 meta kernel 与通用解析/执行机制；业务应用以独立版本化制品经 meta
bootstrap 安装，安装本身有 identity/version/actor 审计且幂等；runtime 只枚举 fold
快照中的活跃定义，缺失即失败。单纯改文件扩展名但保留 service 特权补种不算修复。

## T14 之后补充问题：聊天投影不能跨刷新存活（#13）

客户端只在 final/render 回执到达后才把 sessionId 写 localStorage；服务端也只在 inline
循环完整结束后写 `chat-turn`。rule render、delegated 是历史旁路，在途回合刷新时 user
goal、thinking 与 steps 都只存在 React state，立即丢失。即“事件日志是真相”与用户
实际看到的聊天记录不一致。

期望：请求开始即形成可恢复 turn identity，session 立即交付客户端；可见进度追加留痕，
所有模式统一以 final 收口。history 能把 started/progress/final 合并为一个回合，并在刷新
后持续追踪尚未完成的服务端执行。

## T14 之后补充问题：聊天长流与画布竞态造成真实卡死（#14）

新鲜 `/canvas` 探针响应和 DOM 均正常，但卡死集中发生在长聊天/导航期间：每个
`thinking-delta` 都复制 messages 并触发 assistant-ui 重渲染；画布 `load()` 对快速
concern 变化、手工 reload 和动作后 reload 没有取消、代次或超时，旧异步结果可覆盖新
结果；surface error boundary 以稳定 id 复用，重新载入后仍可能保持旧错误态。三者叠加
会让主线程长时间不可交互或永远停在“加载中”。

期望：reasoning 分片按短窗口合帧；canvas load latest-wins、可取消、有界超时并阻止并发
reload；新 load 重置 boundary。压力验收必须覆盖高频 delta、快速 concern 切换、连续
reload 与迟滞请求，不能再用一次 fresh-page RTT 证明“没有卡死”。

## T14 增补修复复验（#8–#14，2026-08-22）

| 问题 | 复验结果 |
|---|---|
| #8 | 「我要看看第一篇文章」解析为 `post:first-post`，聊天跳转 `/canvas?focus=post%3Afirst-post`；`agent-focus` detail 从合同解引用并显示完整 body，零 freeze。 |
| #9 | LLM 工具面新增 `fail(reason,evidence)`；真实「删除所有文章」在 4 步内明确报告合同无 delete capability，文章仍为 4，未擅自下线/归档；重复合同处境另有机械停滞闸。 |
| #10 | 客户端改为 120s 空闲超时，每帧续期；服务端 15s heartbeat。活跃总时长不再被固定 120s deadline 误杀，人工停止与空闲超时文案分离。 |
| #11 | 成功 navigate 先发 focus SSE，主画布复用同一个临时 detail surface 跟随实体；真实删除目标导航时画布随 `post:post-welcome` 更新。 |
| #12 | publishing/community 的 application/flow/capability/seed 全文迁入版本化 JSON bundle；generic meta bootstrap 解析、校验、幂等安装并留 receipt，runtime 只从 fold 快照枚举，TS 兼容模块仅由制品派生。 |
| #13 | 客户端在 POST 前持久化 session/turn；日志追加 started/progress/final，history 合并 running/final 并轮询在途回合。真实刷新后原 goal/reply 与第一篇正文均恢复。 |
| #14 | reasoning delta 50ms 合帧；canvas load latest-wins、Abort、15s timeout、加载中禁 reload，并以 generation key 重置 boundary；迟到旧 load 测试无法覆盖新 concern。 |

最终证据：`CI=true pnpm check`（121 files：119 passed / 2 Temporal 门控 skipped；1129 tests：1127 passed / 2 skipped）通过；`CI=true pnpm e2e`（36 passed / 14 环境门控 skipped）通过；应用内真实浏览器完成第一篇 focus/body、跨刷新恢复、删除能力诚实失败与画布跟随，页面无 console error。应用由 `pnpm dev:all` 统一入口保持运行（web 3100 / Temporal 7233 / UI 8233）。

## T14 用户故事全链路续修（#15–#22，2026-08-22）

继续按 US-1–US-14 真实走查后，修复了此前“单点验收通过、相邻故事仍断裂”的八个问题：

| # | 现象 | 机制修复 | 复验 |
|---|---|---|---|
| 15 | 放弃向导仍收集当前节点字段；发布后旧字段残留并污染下一篇，首步再次出现重复 title。 | action 增 `collect-node-fields:false`；effect 增通用 `clear-fields`，publish 完成后清空 flow 实例字段。 | 人类与 agent 连续发布互不继承 title/category/tags/body。 |
| 16 | agent 成功执行动作后，聊天显示成功但共享画布仍是动作前快照。 | 成功 exec/exec-plan 发 `focus(refresh=true)`；客户端把 refresh 代次写入 URL，Canvas 绕过实体缓存并 latest-wins。 | 下线、发布、置顶后画布在同一 rel 原位刷新。 |
| 17 | HTTP 202 挂起被当拒绝继续重试，可能生成重复 confirmation。 | agent HTTP/loop 增 `suspended` 终态，202 立即收口并报告确认实体。 | archive 只生成一条 confirmation，不再重复导航或执行。 |
| 18 | confirmation 详情只暴露机器字段；终态后风险信息消失。 | Siren 投影增加人类可读目标、风险、策略、原因；fold 保留 risk/policy/reason。 | pending 与 approved 页面都能说明“确认什么、为何高风险、依据何策略”。 |
| 19 | exec-plan 只回“HTTP 拒绝”，模型看不到具体失败步，无法可靠续步。 | HTTP client 保留 plan detail，loop 把失败步骤与原因写入 `lastRejection.detail`。 | 错字段/缺字段失败能定位到精确 step，已成功前缀不伪回滚。 |
| 20 | meta 聊天起点误入业务站；add-action 的 JSON 被模型序列化成字符串；`agent-focus` 读取 `meta/*` 却请求业务 `/api/entity`，报 404。 | 显式定义意图切 `/_meta`；精确 surface title 优先；JSON field 下发嵌套 schema；exec client 对 `meta/*` 自动选 `/_meta/api/entity|exec`。 | flow 修订、提交、审批、v2 动态动作全链通过；`meta/flow:post-status` 画布详情可读，不再 404。 |
| 21 | “我想处理评论区的事”被模型解释为批准评论，越过人类授权。 | 发现型歧义意图在机械层只 focus 入口、零 exec；明确“审核/通过/驳回”才进入写循环；具体阅读意图不被该闸误拦截。 | 模糊表达只打开 comments 并明确未修改；“我要看看第一篇文章”仍 focus `post:first-post`。 |
| 22 | Vitest DB 测试直接 `TRUNCATE` 本地开发库，运行 check 会抹掉 walkthrough 日志并制造运行中状态漂移。 | Vitest 固定使用幂等创建的 `ui4a_test`，允许 `TEST_DATABASE_URL` 覆盖；文件级 DB 测试继续串行。 | 单独运行 chat route DB 测试前后开发库事件数均为 11；完整 check 不再触碰 dev 日志。 |

其中 #20 的原则是“缺数据不造数据，但必须到正确的合同本源取数据”：业务实体仍走
`/api/entity`，`meta/*` 只走 `/_meta/api/entity`。此前 404 不是定义缺失，而是 renderer
把定义实体发到了错误的业务端点；修复没有补假实体或增加 fallback。

续修最终证据：完整 `check` 与 `e2e` 口径同上；浏览器分别验证
`meta/flow:post-status` 从 `/_meta` 投影为 active v1（零 404），以及刷新后的
`post:first-post` 仍显示完整 body。新鲜日志共 42 条，包含 human/agent 两类
`action-executed`、10 条 `agent-decision`、3 个完整 `chat-turn` 与 1 条带原因的
`action-rejected`；`/events` 机械摘要可逐层下钻。歧义评论意图执行前后 pending 均为 3。
