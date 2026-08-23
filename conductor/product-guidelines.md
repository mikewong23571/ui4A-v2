# 产品指南 — UI4A v2

## 品牌与定位

- **名称**:UI4A v2 — 界面作为合同 (Interface as Contract);
- **定位**:架构验证 demo——目标是端到端验证"界面作为合同"的架构主张,不是产品化 SaaS;
- **语言**:界面文案与项目文档以中文为主;协议、代码、标识符、日志字段为英文。

## 语气与文案 (Voice & Tone)

1. **如实,不粉饰**:失败原样进入对话(无效 API key 的 401 如实呈现,委托不崩溃、不吞错、不伪装成功);
2. **拒绝即教育**:每个拒绝都带可行动的原因(guard 求值结果嵌入动作工具的 description,如 "blocked: is-pending 失败")——拒绝是下一步决策的上下文,不是死胡同;
3. **AI 认知、机械验真**:Assistant 的理解、总结、比较、解释与规划由真实 LLM 完成；审计通道(事件流、机械 diff)、权限、确认、重放保持零 AI，原始事实保留在可展开下钻中;
4. **人机对称**:同一场景,人类走 renderer、agent 走合同,共享同一份日志——界面上呈现给人的状态与 agent 从合同读到的事实完全一致,不做两套叙事;
5. **主标签面向任务**:导航、页面标题、stat 与表单 label 使用人能直接理解的任务语言(如「执行中委托」「委托监控」「定义管理」);合同机器名只在辅助说明或审计下钻中出现。

## UX 原则(从五条铁律推导)

| 原则 | 含义 |
|---|---|
| AI-first 诚实降级 | Assistant 不以 rule driver 兜底；LLM 不可用时明确失败且零副作用。人工 renderer/RJSF 仍可读取、审批并直接执行合同动作，但不冒充自然语言助手 |
| binding-only 渲染 | 渲染 spec 全部为实体引用,渲染器从实体缓存解引用——所见即实体快照,模型发不出一个数字 |
| 交互必背书 | 任何可点元素必映射到已声明 action,提交经引擎裁决;合同外按钮无法提交 |
| 事实来源可见 | 字段的值来源必须声明(默认/查找/引出/效果产出/意图/起草+选择)且可追溯 |
| 审批是人的特权 | approve 永远 actor-is-human;确认门呈现完整上下文(actor / principal / 信道) |
| 拒绝留痕 | 每个被拒动作在日志中带原因,且可作为下一步决策上下文获取 |
| 通道隔离 | 骨架路径(事件流 / diff / 收件箱)静态绑定组件,不经 AI;生成路径只在画布 |
| 呈现旁路 | Chat 只持有薄 request/receipt 与 Sidecar 引用；Recipe/Sidecar 规划、缓存、解释和失败不占用或改写 Chat 语义上下文 |
| 人类优化分级 | 即时预览、个人 Sidecar、共享 Recipe 是三个不同承诺；共享晋升必须先机械参数化/diff，再由 human 确认 |
| 原生认知不物化 | 阅读、总结、比较、解释默认只产生带来源的临时回答；没有明确业务字段/action 时不得自动升级为 artifact |
| 外置 App authoring | 产品 Chat 不内置 App 生成器；外置 Agent 可提候选 Bundle，UI4A 只负责 meta 校验、diff、批准、激活与重放 |

## 视觉与骨架

- **组件库**:shadcn/ui(Base UI 底层),全部用现成组件拼装;
- **骨架五面**:主页(运行概览: stat + timeline)/ 收件箱(kanban / table)/ 事件流(timeline)/ 定义管理(diff + flow)/ 画布(全词汇表);
- **渲染词汇表 MVP 前十词**:table / chart / stat / timeline / flow / form / diff / kanban / markdown / detail;
- **机械 diff**:deep-object-diff + react-diff-view 呈现,可读性优先;
- **画布协议**:语义 Surface Tree 编译为 A2UI(数据与组件分离、客户端渲染器拥有数据模型、action 事件拦截后映射到已声明 action)；不得以 Entity 类型硬编码页面或把原始 fields dump 当主体验。

## 人工评估观察点(持续记录,不计入验收)

- 确认疲劳的真实感受;
- 澄清对话的收敛体验;
- 机械 diff 的可读性;
- 渲染凝固后的稳定性。
