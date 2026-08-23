# T21 Assistant 双焦点事实与 AI-first Presentation 一致性 — Specification

## 类型

Bug Fix

## Overview

当前参考 Assistant 将本轮合同读取位置 `currentRel` 错当成用户浏览器正在显示的页面。每轮重新
解析起始实体后，Agent、Conversation 与 Canvas 的焦点可能分叉，造成错误陈述、无法返回集合，
以及冗余导航。

本 Track 保留两个独立事实：

- `lastNavigation`：最近一次成功的 Agent navigation 或 Presentation receipt。
- `clientView`：用户发送当前消息时，客户端实际可见的 route、subject 与关联 receipt。

两者同时进入 LLM 的有界处境。机械层只负责记录、验证、投影和 provenance，不判断哪个焦点更
符合用户意图。LLM 自主决定回答、澄清、导航或呈现。

## Functional Requirements

### FR1 双事实模型

系统必须分别表达 `lastNavigation` 与 `clientView`，不得折叠为单个 `currentRel`。每项至少保留
subject/rel、来源类型、对应 turn/message/receipt、观察或完成顺序及可用性状态。

### FR2 Last Navigation

成功的 navigation 和可用的 Presentation receipt 必须产生可重放的 `lastNavigation` 投影。失败、
pending 或被 supersede 的结果不得冒充成功导航。

### FR3 Client View

客户端提交用户消息时必须携带当前可见视图的有界观察。`clientView`：

- 是客户端处境事实，不是业务事实；
- 不能授权字段读取、业务 action 或 effect；
- 不能覆盖 `lastNavigation` 历史；
- 缺失时必须表示 unknown，不能从最近导航推断；
- 按客户端实例和当前 turn 解释，不成为跨设备的全局页面真相。

### FR4 LLM Context

下一次 LLM 决策必须同时看到当前用户原话、`lastNavigation`、`clientView`、当前合同观察及
sitemap，以及相关历史目标、约束、拒绝和结果。Prompt 必须明确区分合同读取位置、最近导航
结果、客户端当前可见视图、Presentation subject、业务事实与 effect authorization。

### FR5 AI-first 冲突处理

两项事实冲突时，机械层不得用关键词选择页面、自动令某一事实覆盖另一事实、根据 URL 推导业务
意图，或通过 rule driver 模拟 Assistant 决策。LLM 根据用户目标及两项事实自主选择合法协议操作。

### FR6 同回合多步协议

一次 LLM 决策仍只允许一个协议调用，但一个用户回合可以包含多个决策，例如
`present/navigate → answer`。Presentation 是旁路，不应破坏已经成立的 Chat answer；回答必须继续
保留合同事实来源。

### FR7 协议失败处理

当真实 LLM 输出普通文本而没有协议调用时，可以进行一次或有界次数的 LLM 协议修复。修复仍
使用配置的真实 LLM 和当前合同工具；不得用关键词、正则、文本分类或 rule driver 将文本机械转换
为操作。修复失败时诚实失败，全过程零未授权业务 mutation。具体采用 provider 强制工具调用还是
bounded repair，必须先通过 disposable probe 决定。

### FR8 审计与重放

双事实、来源和修订必须进入现有 append-only Chat/Presentation 事件体系。从空投影重放时，
`lastNavigation` 可机械恢复，`clientView` 保留原始客户端观察，不改变 Business Snapshot hash，
且不引入第二权威状态存储。

## User Stories

### U1 查看具体实体

用户从文章集合说“看看第一篇文章”。Assistant 应基于授权事实理解对象，使用户看到
`post:first-post` 的详情，并可同时给出有来源的回答。不得执行业务 action。

### U2 同时理解两个焦点事实

`lastNavigation` 与 `clientView` 同时存在时，Assistant 的处境必须分别披露两者及 provenance。
它不得把合同读取起点、最近导航目标或客户端可见页面互相冒充。

### U3 查询集合事实不改变当前页面

用户正在查看第一篇详情时问“总共有几篇？”。Assistant 应根据 `articles.count` 回答 2；客户端仍
保持详情页，且 Assistant 不得声称用户已经位于列表页。

### U4 从详情返回集合

承接 U3，用户说“我要看看列表”。Assistant 应使客户端显示 `articles` 集合视图。实现可由 LLM
自主选择合法的 Presentation/navigation 协议，不得依赖“看看/列表”等关键词路由。

### U5 同回合呈现并回答

当目标同时需要界面与自然语言说明时，同一用户回合可以经过多个 LLM 决策完成呈现和回答；每次
决策仍只有一个协议调用，最终回答保留事实来源。

### U6 接受客户端现实与用户纠正

用户手动切换页面，或指出“当前是第一篇详情页”时，Assistant 应使用最新 `clientView` 理解用户
所见，同时保留不同的 `lastNavigation` 历史。不得静默覆盖任一事实或虚构“已经导航”。

### U7 刷新与重连后恢复

刷新或重开同一会话后，`lastNavigation` 从事件日志恢复；`clientView` 由新客户端重新报告。客户端
事实缺失时应标记 unknown，不能用最近导航猜测当前页面。

### U8 LLM 协议失败安全

模型首次输出普通文本而非协议调用时，系统只能进行有界的 LLM 协议修复或诚实失败；不得用
关键词、文本解析或 rule driver 将输出确定性改造成 `answer/present/navigate`。任何失败均为零业务
mutation。

## Golden Story

```text
“看看第一篇文章”
→ 客户端显示 post:first-post 详情

“总共有几篇？”
→ Assistant 回答 2
→ 客户端仍显示详情
→ Assistant 不声称已在列表

“我要看看列表”
→ 客户端显示 articles 集合

“我现在在哪？”
→ Assistant 根据最新 clientView 回答集合页
```

全链业务 mutation 增量为 0；Chat/Presentation/focus 事件 provenance 完整；两个事实可分别审计；
不固定模型措辞和工具轨迹。

## Non-Functional Requirements

- 保持 AI-first，不新增 rule/keyword fallback。
- 不新增依赖或独立状态存储。
- 保持 `shared ← engine ← agent` 依赖方向。
- 客户端观察不得扩大 principal 的授权范围。
- 结构化上下文必须有界。
- 既有 T15 effect authorization、T16 binding-only/Sidecar 和 I1–I7 不变量继续成立。

## Acceptance Gates

- Golden Story 真实 LLM + 浏览器 canonical：100% 通过。
- 四种自然语言变体：用户结果成功率至少 80%。
- Safety：业务 mutation、错误对象和 effect 越权为 0。
- 机械测试覆盖双事实 fold、重放、缺失、冲突和并发客户端。
- SSE/Route/Component 测试覆盖客户端观察上报及 Presentation 导航。
- 协议失败通过注入式测试验证 bounded repair；真实 LLM probe 验证当前 provider 行为。
- `pnpm check` 与相关 Playwright 套件通过。

## Out of Scope

- 根据中文或英文关键词硬编码导航行为。
- 把客户端 URL 变成业务真相。
- 让应用穷举 Agent 的认知能力。
- 跨设备同步一个全局“当前页面”。
- 修改 Business action、guard、schema 或文章数据。
- 引入新的 Agent runtime、模型 provider 或状态数据库。
