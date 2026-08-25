# T16 用户故事 — 语义化 A2UI 呈现与 Render Sidecar

> 故事只规定用户结果、Safety 和可审计证据，不规定固定 A2UI 组件、DOM 顺序、模型措辞或工具轨迹。每条故事必须同时满足列出的验收标准才算关闭。
>
> Chat 只通过薄 Presentation Request/Receipt 委托旁路 Presentation Plane；Application Recipe 提前生成典型场景协议，持久化 Sidecar 只按用户跨 Session 保存，任何 Sidecar key/schema 不得包含 sessionId。

## A. 合同理解与正确性

### S1 当前 Application 自我说明

用户询问“当前应用是干什么的”。Assistant 应根据当前 Application、Flow 和 Entity 合同说明用途，不引用过期实现阶段。

验收标准：

- 回答覆盖 application intent、主要开放 Flow 和当前可操作资源。
- 每个业务事实均有 Siren/sitemap source；不得使用 README/prompt 常量冒充运行事实。
- 不执行业务 action，不生成 Render Sidecar。
- 真实 LLM canonical + 4 变体成功率 ≥80%，事实错误为 0。

### S2 Thinking 严格归属当前回合

用户连续询问应用用途、文章长度和 Markdown 支持。每条可见 thinking 必须属于其当前问题。

验收标准：

- thinking identity 为 `(turnId, step)`；不同 turn 的 step 1 不互相覆盖。
- 刷新/恢复后 thinking 仍保持原回合顺序，或按产品策略明确不恢复；不得错挂。
- UI 中“支持 Markdown 吗”的 reasoning 不得出现在“当前应用是干什么的”下方。
- 组件测试、SSE 集成测试和真实浏览器三层均通过。

### S3 Markdown 能力回答准确

用户询问“支持 Markdown 吗”。Assistant 应区分聊天 Markdown、render vocabulary 和业务字段格式。

验收标准：

- 如实说明聊天 renderer 是否支持 Markdown。
- 如实说明当前 catalog 是否注册 markdown word。
- 只有业务字段声明 Markdown content type 时，才声称该字段支持 Markdown authoring/rendering。
- 不得再声称已存在的 render catalog “尚未实现”。

## B. Entity、Entities、Flow 与合同图

### S4 单 Entity 阅读

用户说“看看第一篇”。系统应呈现文章身份、状态、正文、元数据、动作和关联入口，而不是原始字段转储。

验收标准：

- 主标题是文章身份而非节点标题“已发布”；状态单独呈现。
- 正文在主阅读区域完整可见；category 等信息处于次级层次。
- 所有显示值从 `post:first-post` 实时解引用，source coverage 100%。
- action/links 可发现但不挤占正文；页面无 `fields=...` 原始拼接作为主体验。
- 浏览器视觉 rubric：层次、可读性、任务聚焦、交互清晰度均 ≥4/5。

### S5 Entities 集合浏览

用户说“浏览全部文章”。系统应按当前目标为 `articles.entities[]` 生成可用集合视图。

验收标准：

- 所有授权成员恰好出现一次；新增/删除成员后实时更新。
- 集合外层布局不复制成员事实到 Sidecar。
- 异构成员或缺字段成员局部显示诊断，不拖死整个 Surface。
- 不要求固定 table/grid/kanban；用户能在两次交互内打开目标成员。

### S6 显式多 Entity 比较

用户要求比较两篇文章。系统应为 selection roots 生成并列/差异呈现。

验收标准：

- 两个 Entity 的事实、来源和身份不混淆。
- 只显示用户授权的 selection；缺失成员明确说明。
- 比较结论可由 LLM 生成，但原始字段必须 binding-only 解引用。
- 零业务 mutation，真实 LLM 变体成功率 ≥80%。

### S7 开放 Flow 工作空间

用户进入文章发布 Flow。系统应呈现稳定 Flow Shell、当前任务、上下文、产物和历史。

验收标准：

- 当前 node、进度和可用 actions 来自活跃定义/实例出生版本。
- Current Task 只显示当前节点所需字段；不得混入其他节点表单值。
- Flow transition 后 Shell 保持，Current Task Slot 刷新到新节点。
- 用户能完成 canonical 三步发布；每次提交均经过 action/guard/schema。

### S8 多层 Application 合同图

用户要求“给我一个发布应用工作台”。Agent 应在预算内组合 Application、Flow、集合、Entity、Artifact 和确认状态。

验收标准：

- Agent 显式选择 Data Lens，graph 遍历不超过声明的 `maxDepth/maxNodes`。
- 每条 relation/link 单独授权；不可见节点的存在和数量均不泄露。
- 超出预算的数据以“可继续展开”呈现，不静默丢失关键任务信息。
- Surface 子区域保留各自 source/provenance，可独立刷新和失效。

## C. AI-first A2UI 规划

### S9 首次生成 Surface

Entity 没有可用 User Sidecar 时，Broker 应优先实例化已验证的 Application Recipe；Recipe 也缺失时才由独立 Presentation Agent 根据当前目标生成 binding-only A2UI Surface Tree。

验收标准：

- 报告 User Sidecar/Application Recipe/generic/planner 的实际命中路径。
- Surface 至少覆盖完成当前用户任务所需的信息与交互。
- factual bind 中无正文、数量、状态等裸字面；validator 100% 通过。
- Application Recipe 命中时 Presentation LLM 调用为 0；动态生成记录独立 Presentation driver/model。
- 生成失败时 Chat answer 保持成功并回退高质量通用 renderer，不输出半成品 Surface。

### S10 同一 Subject 的不同 Intent

用户分别提出“阅读文章”“编辑文章”“解释文章动作”。同一 Entity 应产生适合目标的不同呈现。

验收标准：

- Render Situation 的 intent 不同，Sidecar key 不碰撞。
- 三个 Surface 均可完成对应任务，不要求固定组件名称。
- 不存在 `post → ArticlePage` 或 action 关键词 route 分支。
- 源级治理测试阻止 entity type 到页面组件的产品映射。

### S11 多区域 Surface Tree

Agent 需要同时呈现正文、元数据和动作时，应组合多个区域而不是单 `detail` word。

验收标准：

- 协议支持 layout、slot、repeat 与多个 catalog word。
- 每个子树有独立 bindings 和 dependency manifest。
- 一个子树失败时其他已验证区域仍可用，并显示局部诊断。
- A2UI processor、UI4A deref 和 React renderer 对同一 normalized plan 一致。

### S12 新合同无需 Renderer 代码

维护者激活一种新 Entity/字段/action 后，Agent 应在不修改 Renderer、chat route 和 prompt 的情况下呈现它。

验收标准：

- 新定义只经 meta 激活进入 sitemap/Siren。
- 激活后 Scenario Enumerator 自动产生/失效相关 descriptor，并异步生成新 Application Recipe；失败不阻断激活。
- 下一次真实 Presentation LLM planning 自动发现新语义和 action schema。
- 通用 fallback 仍可读、可操作；无专用组件也不能退化为不可用。
- source scan 中没有新实体名、action 名或 prompt example 特判。

## D. Action 交互

### S13 无字段 Action

用户在 Surface 中点击一个无字段 action。

验收标准：

- 控件来自实时 `entity.actions[]`，携带准确 rel/action。
- 点击前重新读取 declaration 和 guard；合同已删除时零 POST。
- 成功请求只产生预期 effect，并刷新相关 Surface。
- Sidecar 不缓存 enabled/blocked 状态。

### S14 有字段 Action

用户执行需要输入的 action。系统应以适合当前 Surface 的表单交互收集参数。

验收标准：

- 字段、label、description、required 和 enum 全部来自 action JSON Schema。
- Dialog/Drawer/inline 的选择可以动态变化，但键盘和焦点管理必须通过。
- 提交剥离 schema 外字段；非法值显示 engine 拒绝原因。
- 打开或取消表单不产生业务事件。

### S15 高风险 Action

用户点击归档等 high-risk action。

验收标准：

- 首次提交产生 pending confirmation，业务状态不变。
- Surface 清楚区分“已请求”和“已执行”。
- 只有 actor=human 的 approve/reject 可以结束确认。
- 批准后业务 effect、Sidecar 刷新和审计解释一致。

### S16 集合成员 Action

用户在 Entities Surface 中操作某个成员。

验收标准：

- action context 使用该成员真实 rel，不使用 collection rel 或视觉索引。
- 其他成员的投影和事件不变。
- 成员排序/筛选变化后仍操作正确对象。
- 批量 action 只有合同显式声明时才可出现。

### S17 过期 Sidecar Action

Sidecar 保存后，定义删除或阻断了其中一个 action。

验收标准：

- fastpath 校验发现 action dependency 漂移。
- 过期控件不提交；相关子树 stale 或重新规划。
- 页面其余只读内容继续可用。
- 审计记录 invalidation 原因、旧/新 definition version。

## E. Sidecar 与 fastpath

### S18 用户级跨 Session Entity fastpath

用户在 Chat Session A 首次成功呈现 Entity，关闭后在 Session B、Canvas 或直接 Entity 页面以同一 intent 再次查看。

验收标准：

- 所有入口命中相同 User Sidecar id/version；持久化 key/schema 中无 sessionId。
- 首屏前 Chat/Presentation LLM call count 均为 0。
- 重新授权并解引用当前 Entity，旧事实不会从 Sidecar 泄露。
- 本地基准首个可用 Surface ≤500ms。
- render receipt 记录 sidecar id/version 和 dependency validation。

### S19 Entities 成员变化后复用

Sidecar 保存后集合新增或删除成员，用户再次浏览集合。

验收标准：

- 外层 Sidecar 继续命中，repeat 使用实时 `entities[]`。
- 新成员自动出现、删除成员消失，无 LLM 调用。
- 依赖维度仍存在时不因 count 变化失效。
- 成员 item recipe 的事实与 action 逐项重新解引用。

### S20 Flow Shell 与节点 Sidecar

用户在开放 Flow 中跨节点操作。

验收标准：

- Flow Shell Sidecar 跨 transition 保留。
- node Sidecar 以 definition version + node + intent 区分。
- 只重规划失效 Current Task 子树，已验证 Context/History 不闪退或重建。
- 新节点首屏与业务实例当前状态一致。

### S21 值变化与结构变化

同一 Sidecar 分别遇到字段值变化和 schema/action 结构变化。

验收标准：

- 值变化只重新解引用，不失效布局。
- schema/action/catalog/policy scope 不兼容必定 stale，错误复用率 0。
- dependency fingerprint 与失效理由可审计。
- stale plan 不得在后台继续响应用户交互。

### S22 子树级重规划

多层 Surface 只有 Artifact 区域依赖失效。

验收标准：

- 仅 Artifact Slot 进入 loading/replan；其他区域保持交互。
- 新旧子树切换原子，不显示混合版本事实。
- LLM 只收到失效子树所需的有界合同上下文。
- 最终 receipt 列出 reused/replanned subtree ids。

### S23 LLM 不可用时的 fastpath

模型不可用时，用户直接打开已有 Sidecar 的 Entity；随后又提出新的自然语言布局需求。

验收标准：

- 已验证 fastpath 与人工 renderer 正常工作，零 LLM 请求。
- 新自然语言规划诚实失败，保留当前可用 Surface。
- 不 fallback 到 rule driver，不删除已有 Sidecar。
- 零业务副作用。
- Chat Agent 正常而 Presentation Agent 失败时，Chat answer 必须继续成功；Application Recipe 命中仍可呈现。

## F. 人类优化与生命周期

### S24 自然语言优化

用户说“正文更突出，动作收起来”。Agent 应修订当前 Surface 而不改变业务事实。

验收标准：

- 生成 Render Patch，引用原 Sidecar version 和用户 message id。
- Patch 只改变语义布局/密度/强调，不修改 bindings 的事实值。
- Preview 可立即撤销；业务事件差分为空。
- 真实 LLM 4 个表达变体成功率 ≥80%。

### S25 直接操作优化

用户拖动、折叠或切换兼容视图。

验收标准：

- 直接操作转换为受限语义 patch，不保存 CSS、像素事实或任意代码。
- 操作后 keyboard/ARIA 仍通过。
- 未提交 preview 可暂存在当前 UI；提交后的结果立即写入用户级 Sidecar，用户可一键恢复。
- 高频拖动可以合并，但最终 durable 版本必须确定。

### S26 保存用户级 Sidecar

用户选择“以后我都这样看”。

验收标准：

- 新 User Sidecar 绑定 principal/policy scope，retention 从 cache 变为 pinned，其他用户不可命中。
- 保存是 Render Sidecar 域事件，不写业务 Entity 字段。
- 任意后续 Session/Canvas/直接页面的相同 Situation 命中同一 fastpath，显示当前事实。
- UI 清楚显示已保存、版本号和撤销入口。

### S27 User Sidecar 晋升 Application Recipe

用户选择“设为团队默认”。

验收标准：

- 系统先参数化 subject slots、移除 principal/Entity 值，再展示候选 Recipe 与当前 promoted Recipe 的结构 diff。
- 产生 pending promotion；确认前其他用户不受影响。
- 只有 actor=human 可 approve；批准后生成新共享版本。
- promoted Application Recipe 可按 definition/catalog version 回退。

### S28 回退渲染版本

用户认为新效果更差并选择恢复上一版本。

验收标准：

- 回退只移动 Sidecar active pointer，历史版本不可变。
- 当前业务 Entity、action 和事件状态不改变。
- 回退后下一次 fastpath 使用目标版本并重新校验依赖。
- audit 清楚记录 actor、from/to version 和 reason。

## G. 故障、安全、解释与质量

### S29 未授权多层数据

Surface Lens 指向一个无权限关联 Entity。

验收标准：

- 授权过滤发生在规划输入和 fastpath hydration 两个边界。
- UI 不显示该 Entity 的 rel、标题、数量或占位暗示。
- 其他授权区域继续工作。
- 机械安全测试覆盖 direct、member、relation 和 nested slot 四种泄露路径。

### S30 Catalog/Sidecar 损坏

Sidecar 引用不存在的 A2UI word 或不合法 bind。

验收标准：

- validator 在呈现和交互前拒绝该 Sidecar。
- 使用高质量 generic fallback；不得整页空白或显示半成品。
- 损坏版本标记 stale，原始载荷保留供审计。
- 不执行 Surface 中的任何 action event。

### S31 解释展示决策

用户询问“为什么这样展示”。

验收标准：

- 解释包含用户目标、Data Lens、关键 bindings、catalog words 和 Sidecar hit/miss。
- 明确区分应用语义、LLM 规划、人类 patch 和机械 validator 决定。
- 缺少 provenance 时承认无法解释，不补造原因。
- 回答零业务 mutation，source 可追溯。

### S32 Replay、响应式与人工质量门

系统从日志重放 Sidecar 生命周期，并在桌面、窄屏和键盘模式下复走 Golden Story。

验收标准：

- 重放前后 Sidecar active version、dependencies、provenance 和 invalidation 状态一致。
- Golden Story：了解 Application → 浏览 Entities → 打开 Entity → 首次生成 → 人类优化 → 保存 → action/确认 → fastpath 返回 → 解释原因。
- 桌面/窄屏均无关键内容溢出；完整键盘操作、焦点回收和 ARIA 通过。
- 浏览器任务完成率 100%，工程视觉 rubric 和人工 rubric 均值分别 ≥4/5。
- `pnpm check`、全量 Playwright、真实 LLM Story Eval 和 source-governance 全绿。
