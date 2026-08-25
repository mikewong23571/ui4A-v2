# T21 Technical Stories — 双焦点事实与 AI-first Presentation 一致性

## TS1 Shared Dual-Focus Contract

在 shared contract 中定义有界 `ClientViewReport`、`ClientViewFact` 与 `LastNavigationFact`，复用
`RenderSubject`，并提供 fail-closed parser。

DoD：shape/bounds/unknown/selection tests；客户端输入不能携 principal、授权或任意事实 payload。

## TS2 Client View Capture

客户端在提交用户原话的同一时刻观察真实 `pathname + search`、hook-lifetime client instance 和
仍与当前 URL 匹配的 receipt reference。

DoD：direct rel、Canvas focus/roots、手动 back、refresh、两个窗口及 unknown tests；不从
`lastFocus`、聊天历史或自然语言推断页面。

## TS3 Atomic User Message Observation

把可选 `clientView` 放进不可变 user `chat-message-appended` detail，与 messageId/turnId 原话一次
append。

DoD：route parse/400、atomic persistence、legacy omission compatibility；无孤立 client-view event。

## TS4 Navigation Completion Event and Fold

成功 Agent navigate 或 ready/fallback Presentation receipt 追加幂等
`chat-navigation-completed`；纯 conversation fold 独立投影 `lastNavigation` 与当前 user message 的
`clientView`。

DoD：乱序、重复、session/client isolation、missing view、failed/pending/superseded receipt、空投影
replay tests。

## TS5 Agent Context Disclosure

Driver context 和 prompt 分别披露本轮合同读取位置、`lastNavigation`、`clientView` 及 provenance。

DoD：三项有独立标题/shape；冲突/unknown tests；不得把任何一项描述成另一个事实。

## TS6 Async Presentation Ordering

Chat 跟踪 Presentation jobs。可用 receipt 先持久化 navigation completion，再发给客户端；Chat answer
不等待 Presentation 才成立，但 SSE 在 jobs settled 前不丢弃 receipt。

DoD：pending→ready/fallback/failed、final-before-receipt-compatible、disconnect、duplicate request tests。

## TS7 Multi-Decision Turn Semantics

明确一个模型 decision 一个工具调用、一个用户 turn 可以多次 decision。`present`/`navigate` 后可继续
`answer`，不要求固定组合。

DoD：injected-driver tests 覆盖 present→answer、navigate→answer、answer terminal 和 max-step safety。

## TS8 Provider-Native Protocol Constraint and Repair

按 probe 结果使用 provider-native `toolChoice:'required'`。无调用、未知工具或非法参数最多再进行一次
真实 LLM repair；绝不解析 text-only 输出为 operation。

DoD：四种 injected failure、attempt budget、same tools/facts、honest terminal failure；真实 provider
canonical + 4 variants gate。

## TS9 Authorization Isolation

客户端视图和导航事实只进入处境，不进入合同观察、Siren tool projection、effect authorization 或
Business fold。

DoD：forged subject/route fuzz；可见但未授权 rel 零泄漏；Business Snapshot hash 不变。

## TS10 Executable Source Governance

阻止产品代码按“看看/列表/详情”等短语、语言关键词、正则或 rule driver 决定展示/navigation。

DoD：低误报 source test 覆盖 Chat Route、Agent driver 和 client capture；测试语料文件允许故事文本。

## TS11 Golden Story Browser and Eval

真实浏览器与 LLM 完成“查看详情 → 查询数量且保持详情 → 返回列表 → 说明当前位置”。

DoD：canonical 100%，四变体 ≥80%；URL/visible subject、双事实 prompt、receipts、sources、event deltas
和 hashes 进入 `t21-evidence/v1`。

## TS12 Replay, Documentation and Closure

从空投影重建双事实，运行 T15/T16/I1–I7 回归并同步正典。

DoD：focused/full tests、real LLM/browser、live walkthrough、Git notes、DONE 与 Principal review 无 High。
