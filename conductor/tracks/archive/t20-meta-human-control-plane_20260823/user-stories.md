# T20 User Stories — Meta Human Control Plane

> 验收关注人类是否能发现、理解、治理和恢复，不固定 DOM 结构、CSS class、表格列顺序或文案逐字快照。视觉截图用于回归和人工 QA，不能单独证明可用性。

## A. 发现与定位

### U1 动态发现全部 Meta 面

作为治理者，我打开 `/meta` 就能看到当前授权范围内的所有顶层 Meta surface。

验收：当前 7 个顶层面一次交互可达；注入 `meta/widgets` 后零首页代码改动即可出现；业务 sitemap 仍无 Meta 入口。

### U2 安全切换 Scope

作为拥有多个授权 scope 的用户，我能明确知道当前 scope，并切换到另一个已授权 scope。

验收：development/editorial/governance 分别看到 Coding/Writing/Authoring definitions；未授权 scope 不出现在选择项且伪造 URL/header 被服务端拒绝；刷新保持 URL 上下文。

### U3 搜索和筛选治理对象

作为治理者，我能按名称、intent、类型、status 找到 Application、Flow、Capability、Draft 和 Agent Definition。

验收：搜索索引只含已授权 sitemap/entities；pending/invalid 可一键筛选；零结果与失败状态可区分。

### U4 五秒内理解当前页面

作为第一次进入对象详情的人，我无需看 raw JSON 就能理解对象类型、状态、目标和下一步。

验收：主标题、状态、intent、关键关系和主要任务在首屏形成清晰层级；technical identifier 是辅助信息而非唯一标题。

## B. Application 地图

### U5 浏览 Application 列表

验收：6 个 Application 的 title、intent、version、Flow/Capability 数量与合同一致；列表成员链接到 exact entity；loading/empty/error 诚实呈现。

### U6 理解 Application 组成

验收：详情展示 Overview、Flow、Capability、Policy、Version/Provenance；用户 30 秒内能指出应用目的及一个可执行能力；默认不展示整包 Bundle dump。

### U7 沿关系连续导航

验收：Application ↔ Flow、Capability，Agent Definition ↔ Run/Draft 可双向导航；breadcrumb 稳定；两次交互内从 Application 到任意所属 Flow。

### U8 保持 Application 边界

验收：没有合同 action 时页面只读；不出现 create/edit/activate 按钮；完整 App authoring 仍指向外置 Agent + Meta Draft 边界说明。

## C. Agent Definition 合同

### U9 浏览 Scoped Agent Definitions

验收：列表只显示当前 scope 授权 definitions；count/exact/list 一致；跨 scope 名称、hash、数量零泄漏。

### U10 理解专业 Agent 权限

验收：Overview、Prompt、Task/Result、Runtime、Tools/Resources、Evaluation、Versions 清晰分区；用户 60 秒内能说出该 Agent 能做什么、不能做什么、需要什么 runtime。

### U11 区分 Authority、Binding 与 Deployment

验收：sealed authority、instruction、task/context binding 视觉可区分；runtime requirement 与 deployment profile 概念分开；endpoint/key/env value 永不显示。

### U12 从 Run 回看出生版本

验收：Agent Run 链接 exact Definition birth version；激活新版本后旧链接内容/hash 不漂移；缺失/未授权 exact read 诚实失败。

## D. Draft 与人类决策

### U13 浏览和筛选 Draft

验收：列表展示 owner/scope/kind/target/status/version/expiry；invalid、pending-approval、terminal 可筛选；只显示授权 Draft。

### U14 修复 Invalid Draft

验收：validation issues 置顶并给出字段/规则/下一步；revise action 使用当前 schema/CAS；修复后重新 validate，旧版本仍可审计。

### U15 在一个工作台审查候选

验收：authored/effective diff、checks、Eval、sources、provenance 分区可见；失败项优先；hash 可复制/展开；默认无需 raw JSON。

### U16 完成人类审批

验收：Agent/system approve 100% 拒绝留痕；human approve 原子 activation + Draft accepted；reject reason 必填；stale/CAS 零半激活且保留审查现场。

### U17 从 Authoring Run 继续到 Draft

验收：成功结果一次点击进入真实 Draft；invalid candidate 可修订；Run 失败零 Draft；Draft 回链 source Run/result/evidence；Agent 不能自批。

### U18 从失败和刷新中恢复

验收：network/404/unauthorized/stale/partial section failure 有可行动提示；刷新从 URL 与事件投影恢复；projection rebuild 后页面事实/hash 一致。

## E. Renderer 质量与可持续增长

### U19 Generic Fallback 不白屏也不冒充特化 UX

验收：未知合法 collection/detail 显示 title/properties/links/actions/raw contract；已注册 Application/Agent Definition/Draft class 使用特化 Renderer；registry 不判断业务名称。

### U20 所有交互由实时合同背书

验收：按钮来自当前 Siren actions；点击前重拉 entity；internal callback 不显示；伪造 action undeclared；action fuzz 100% 通过。

### U21 响应式、无障碍和感知性能

验收：390px 无页面级横向溢出；键盘可完成浏览/修订/审批；可见焦点与语义结构通过检查；无 N+1；本地主要内容 p95 目标 <1 秒。

### U22 人工可用性走查

验收：至少一名人类完成 Application 定位、Agent 权限解释、Draft 决策三项任务；分别满足 30/60/90 秒预算；记录犹豫点、误读、点击数、raw JSON 依赖和视觉问题，Critical/High UX 问题为零。
