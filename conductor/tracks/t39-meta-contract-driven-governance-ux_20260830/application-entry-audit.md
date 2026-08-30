# T39 Application 入口与默认组合面审计（2026-08-30）

## 审计范围与证据

本审计以当前本地运行实例为准，逐一访问：

- `/` Application 总入口；
- `/canvas?scope=default`；
- `/canvas?scope=publishing`；
- `/canvas?scope=community`；
- `/canvas?scope=development`；
- `/canvas?scope=editorial`；
- `/canvas?scope=governance`；
- `/canvas?scope=todo`；
- `/canvas?scope=ideas`。

每个入口均读取可见 DOM 并进行桌面截图；publishing 与 community 另以 390×844
视口核对窄屏效果。合同侧交叉读取 Application bundle、`ApplicationDefinition`、
`SitemapSurface`、动态 `workspace:app:<scope>` 组合推导和 T37/T38 验收记录。

`ui4a` 可执行文件当前未安装，因此本轮没有伪造 CLI 结果；Agent 同门判断来自同一
sitemap/Siren 投影源码与既有合同测试。

## 总结

当前 Application 入口已经做到“零 per-app React 页面”，但只完成了通用拼装，尚未形成
真正的 Application 体验。根因不是缺少更多组件，而是 Meta/Application 定义只有
`name/title/intent/entry`，Sitemap surface 只有 `rel/title/collection/app` 等机械字段，
无法表达一个 surface 在 Application 入口中的任务角色、优先级、空态、密度和可见性。

动态组合因此只能使用统一规则：

1. 取该 app 的全部 pageable collection；
2. 把声明 entry 追加到末尾；
3. collection 一律 table，entry 一律 entity card。

这条规则对 publishing 的 happy path 勉强成立，但在其余 Application 上产生四类系统性问题：

- Application 的 title/intent 不进入主画面，用户只看到“共同注视”和机器 scope；
- collection 与 entry 可能是同一工作对象，导致实体和动作重复；
- surface 归属从 append/extraSurface 猜测，comments 被归到 default，只靠 community.entry 修补；
- entry 只是一条 rel，无法区分“创建入口、审核队列、当前任务、结果目录、跨站桥”。

## Application 总入口

### 当前效果

- 首页以七个同款 chip 展示 Application；intent 只存在于 `title` tooltip。
- 超过六个后按安装顺序折叠，ideas 成为默认隐藏项。
- 没有常用/最近/pin 顺序；用户无法从入口理解每个 Application 能做什么。
- `default` 通过 React 中的 `application.name !== 'default'` 特判隐藏。
- 点击后统一进入 `/canvas?scope=<name>`，主标题仍是“共同注视”，Application 标题没有上肩。

### 问题

入口更像 scope 开关，而不是“图书馆中的应用入口”。当前代码虽没有为七个 Application
分别写页面，却仍以 `default` 名字分支决定可见性，且把用户偏好、系统可见性和声明顺序混为一体。

### 正确归属

- Application 是否出现在人类书架：Meta 定义的 discoverability trait；
- Application title/intent：现有定义事实，必须进入入口与 landing header；
- 用户 pin/recent：用户级 Presentation/Sidecar 偏好，不进入 Application 定义真相；
- 折叠阈值和窄屏排版：舞台机械，不进入业务定义。

## 分 Application 审计

### default

当前直访同时出现 comments 审核队列和 article-drafting 入口，但 `default.intent` 明确说明它只
是未声明归属的归一化地板，不承载业务语义。

根因：

- comments 是 extra surface，未声明 app 后被 sitemap 默认归到 default；
- default.entry 又跨到 publishing 的 `flow:article-drafting`；
- React 仅隐藏书架入口，没有阻止 direct landing 形成错误组合。

结论：default 应由 Meta trait 声明为 `system-fallback/non-discoverable`；可直读审计，但不应生成
工作站 Application landing。可发现 Application 的 entry 必须通过归属不变式，不得跨 app 借入口。

### publishing

当前页面由 articles 长表和 article-drafting 入口组成，功能可用，但存在：

- 页面主标题是“共同注视”，没有“内容发布”与 intent；
- region 标题显示 raw `articles`、`article-drafting:main`；
- 20 行列表先占满首屏，创建文章入口沉到底部；
- 每行同时呈现正文摘要、分类和两个动作，390px 下被压缩成不可快速阅读的窄列；
- table 在 DOM 中按成员形成多个 table/rowgroup，语义上不像一个集合表。

需要由声明表达：articles 是 `output-catalog`，article-drafting 是 `primary-create`；桌面可表格，
窄屏应退化为 compact cards；Application landing 先显示 title/intent，再按任务角色组织。

### community

当前页面提供状态过滤和通过/驳回，责任动作很近，但每行身份统一显示“评论审核”，正文
“好文章/学习了/期待下一篇”完全缺席。用户无法在不进入详情的情况下做负责任的审核。

根因不是 Renderer 丢字段：seed 中存在 `fields.body`，但 `comment-moderation` Flow 没有声明
body 字段及 presentation role，投影不能把它当作可展示事实。

需要：

- Flow/实体定义补齐 `body` 的字段声明与 `primary-content + overview`；
- comments surface 声明 `review-queue/human-responsibility`；
- pending-first 或状态分组由 trait/hint 表达；
- 默认面以评论正文为主要信息，状态和动作次之；
- 390px 使用决策卡，而不是压缩四列表格。

### development

software-changes collection 与 entry `flow:software-change` 最终都解析到
`software-change:main`，同一实体和“开始编码实施”动作在页面出现两次。

入口没有展示 repository、目标、约束、验收标准或运行进度；初始状态只剩“待实施”和一个
复杂表单触发器。当前 action fields 中多数字段没有人类 title/description，repositoryRef 还是
裸文本而非授权仓库选择器。

需要：

- entry 声明为 `primary-task`；software-changes 声明为 `task-history/work-queue`；
- 组合机按 canonical entity rel 去重，entry 与 collection member 重合时由 task role 决定保留姿态；
- action 字段补齐任务标题、说明和 lookup/selection 来源；
- running/review-ready 状态通过 links/traits 带出 Agent Run、tests、artifacts 与责任点。

### editorial

与 development 同构：writing-requests collection 与 entry 同时展示
`writing-request:main`，并重复“开始写作”。页面没有 Application intent，也没有把 Brief、来源、
引用与渲染证据组织成写作任务。

需要：

- `primary-task + task-history` 角色与 canonical 去重；
- sources 字段从任意 JSON 编辑退为授权来源选择器；
- review-ready 通过 link/trait 声明结果、引用、render evidence 和 human decision；
- “接受不等于发布”应来自 Application/状态合同并进入责任点摘要，而不是页面模板。

### governance

这是最严重的入口错误。Application intent 是“生成 Agent Definition Draft 并由人类批准”，但
entry 声明为 `meta/flows`。进入工作站后看到的是全部十个 Flow 的 Meta 集合，每个 Flow 都出现
修订/废弃动作，完全没有展示 `flow:agent-definition-authoring` 的业务入口。

它同时违反：

- workstation 与 meta 必须物理分隔；
- 进入定义层必须显式意图；
- Application 默认页应围绕本 Application 的工作，而不是全局 Meta 资源表；
- scope=governance 不应自动把用户带进 Meta plane。

需要：

- governance.entry 改为归属自身的 `flow:agent-definition-authoring`；
- 业务入口展示“描述专业 Agent”与当前 authoring request；
- Draft 生成后通过显式、scope-preserving bridge 进入 Meta Draft 审查；
- 加入不变式：workstation-discoverable Application 的 entry 必须是本 app 的 business surface；
- Meta 资源不得作为工作站 Application landing 的隐式 source。

### todo

todos 列表与 todo-capture 入口同时出现，但 capture flow 在 recorded 状态保留上次输入 title，
region 标题因此显示最近创建的待办名，而不是“待办捕捉/快速添加”。它与新生成 todo item 看起来
像同一条内容重复出现。

需要：

- capture flow 声明 `primary-create/transient-entry`；
- region heading 使用声明 surface title，不使用瞬态实例 identity；
- todos 声明 `work-queue`，默认优先显示 open，done/archived 通过过滤或次级分组到达；
- 空态直接解释“还没有待办”并把添加入口提升，而不是显示 raw `todos` 空表。

### ideas

空 ideas 集合只显示 raw 标题，捕捉入口显示 `idea-capture:main`。主要动作存在，但没有 Application
intent、空态引导或“捕捉→发展→成熟”的过程说明。

需要：

- capture flow 声明 `primary-create`，ideas 声明 `work-queue`；
- 空集合用声明 title/description 呈现任务空态；
- developing/matured 通过状态 facet 或语义分组表达；
- 入口标题固定取“想法捕捉”，不暴露实例 rel。

## 结构性根因

### ApplicationDefinition 过薄

当前只有 `name/title/intent/entry/submission`，足以发现 Application，不足以描述 Application
landing 的任务角色、可见性和展示姿态。

### SitemapSurface 只有机械形状

当前 `rel/title/collection/pageable/scope/app` 无法表达：

- 这是创建入口、工作队列、产物目录、审核责任点还是历史；
- 在首屏的优先级；
- 空态是否应隐藏或提升 CTA；
- 桌面/窄屏适合 table、card 还是 decision-list；
- surface 是否只用于系统审计而不应出现在人类书架。

### 组合推导只懂 collection + entry

当前算法把所有 pageable collection 放前、entry 放后，按 source rel 去重；它不理解 canonical
entity 重合，也不理解任务角色，因而产生 development/editorial 重复和 publishing 创建入口沉底。

### Collection 归属推导不完整

append 目标可以推导归属，但 comments 这类 seed/声明 collection 没有 append 来源，被
extraSurface 默认归到 default。Flow 已有 `collections` 声明，应由这份定义数据提供 app 归属。

### 定义字段与实际事实不闭合

comment seed 有 body，但 Flow 没有字段声明；系统虽保存事实，却不能以合同驱动方式展示。
应增加机械验证：实例/seed 中可展示业务字段必须有字段定义与来源/role，不能靠 generic dump。

## 建议的 Meta/Application 数据结构

以下是语义能力边界，不是最终 wire shape；Phase A spike 应定型并优先复用现有结构。

### Application traits

- `discoverable`：进入人类 Application 书架；
- `system-fallback`：定义归属地板，可审计但不生成 landing；
- `workspace-entry`：允许由工作站生成 Application landing；
- `cross-plane-bridge`：只声明显式桥，不允许作为隐式 entry。

### Entry declaration

将单一 entry rel 扩展为带语义的入口声明，至少表达：

- target rel；
- role：`primary-create | primary-task | primary-collection | resume`；
- 对人的 title/description；
- 空态 posture；
- entry 必须与 Application 归属一致的机械不变式。

### Surface traits

- `primary-create`；
- `primary-task`；
- `work-queue`；
- `review-queue`；
- `output-catalog`；
- `task-history`；
- `human-responsibility`；
- `audit-only`。

这些 trait 只决定通用词汇和信息优先级，不绑定实体类型或 Application 名。

### Semantic hints 与 Presentation policy

- 定义侧只保留 `priority`、认知分组、overview 与空态含义；
- `density: table | card | decision-list` 属 Presentation policy；
- 390px 通用退化属 Presentation policy；
- heading source 与 sticky/inline 属 Presentation policy；
- `overviewFields` 继续复用现有 field presentation role/overview；

业务/Meta Hint 不允许 CSS、像素、组件名、设备策略、自由布局树或 Application 专属文案模板。

## 北极星复审补充

- Application landing 是图书馆中的能力说明与发起入口，不拥有“在等我/在动/最近事件”；这些继续属于 `/` 与 Work Thread。
- 完整 Draft 创建和复杂修订由外部 Agent、CLI 或 Assistant 原话授权承担；Meta 人类主路径聚焦 validation、diff、checks 与责任决定。
- 同一扇门要求事实、动作、关系和认知语义同源，不要求 Agent 消费 table/card、sticky 或窄屏布局。
- T39 必须新增真实 Assistant 共同注视故事，并证明视觉 metadata 不进入 scoped prompt。

### Application header 的事实来源

Application title/intent 是定义平面事实。组合面需要 binding-only 地引用它们，不能复制为
Surface literal。Phase A 应比较：

1. definition/sitemap binding；
2. 只读 Application projection；
3. 组合虚主体的 definition dependency。

不得通过跨站读取 `meta/application:*` 把 Meta plane 偷渡进 workstation。

### Canonical 去重

组合规划在 sources 解析后按 canonical entity rel 去重：

- entry 与 collection member 相同：按 surface role 决定呈现一次；
- 同一 action 不得在同一 Application 首屏重复；
- 只按事实 identity 去重，不按标题或文本猜测。

### 用户偏好边界

pin、最近使用、个人排序属于用户级 Presentation/Sidecar；Meta 只声明 discoverability、默认优先级
和任务角色。不得把个人偏好写回 Application Definition。

## Track 影响

本审计将 Application 入口纳入 T39，但仍不做 workstation/Canvas 全站视觉改版。范围限定为：

- Application 书架；
- `workspace:app:<scope>` 默认组合；
- 支撑它们的 Meta definition/sitemap/Siren Trait/Hint；
- 八个 Application 的声明数据修复与同门验收。

实现必须证明：新增第九个 Application 只需定义数据，即可自动获得标题、intent、入口、队列、
产物、空态、责任点、窄屏密度与 Agent 同门发现。
