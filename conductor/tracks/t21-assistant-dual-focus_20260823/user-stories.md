# T21 User Stories — Assistant 双焦点事实与 AI-first Presentation 一致性

> 验收关注用户结果、双焦点事实及其 provenance、安全边界和可重放性。模型可以使用不同措辞、
> 决策数量和合法协议轨迹；不得以固定文案、固定工具顺序或关键词分支作为通过条件。

## A. 双焦点事实

### U1 查看具体实体

用户从文章集合表达查看第一篇文章的目标时，Assistant 基于授权合同事实理解对象，使客户端显示
`post:first-post` 详情，并可同时给出带来源的回答。

验收：最终可见 subject 是 `post:first-post`；回答中使用的事实可追溯到授权来源；业务 action 和
业务事件增量均为 0。验收不要求逐字匹配“看看第一篇文章”，也不指定使用 navigation 还是
Presentation。

### U2 同时理解两个焦点事实

`lastNavigation` 与 `clientView` 同时存在时，Assistant 的有界处境分别披露两者及 provenance。

验收：LLM 输入能区分合同读取位置、最近成功导航和客户端当前可见视图；两项事实都保留自己的
subject、来源和关联 turn/message/receipt；任何一项都不得被另一项静默覆盖或冒充。

### U3 查询集合事实不改变当前页面

用户正在查看第一篇详情时询问文章总数，Assistant 根据 `articles.count` 回答 2，客户端继续显示
第一篇详情。

验收：回答来源包含获授权的集合事实；回复后可见 subject 仍为 `post:first-post`；Assistant 不得
声称用户已经位于列表页；业务 mutation 增量为 0。

### U4 从详情返回集合

承接 U3，用户表达返回文章列表的目标时，Assistant 使客户端显示 `articles` 集合视图。

验收：最终可见 subject 是 `articles`；LLM 自主选择合同允许的 navigation 或 Presentation 操作；
产品代码不得依据“看看”“列表”“详情”或其语言变体做路由、意图分类或固定 fallback。

## B. AI-first 交互与恢复

### U5 同回合呈现并回答

当一个目标同时需要改变可见界面和提供自然语言说明时，同一用户回合可以经过多个 LLM 决策完成
呈现和回答。

验收：每次 LLM 决策最多产生一个协议调用；一个回合不被机械限制为只能呈现或只能回答；最终
回答保留事实来源。多步能力是协议能力，不要求所有成功故事使用相同决策数或固定操作顺序。

### U6 接受客户端现实与用户纠正

用户手动切换页面，或指出当前正在查看第一篇详情时，Assistant 使用最新 `clientView` 理解用户
所见，同时保留不同的 `lastNavigation` 历史。

验收：客户端观察不会被旧导航覆盖，最近导航历史也不会因客户端观察消失；Assistant 不虚构已
完成的导航；机械层不替 LLM 裁定冲突事实对应的下一步意图。

### U7 刷新与重连后恢复

刷新或重开同一会话后，`lastNavigation` 从 append-only 事件投影恢复，`clientView` 由新的客户端
观察重新报告。

验收：空投影重放得到同一个 `lastNavigation`；新客户端实例的观察与旧实例可区分；缺失客户端
观察时明确为 unknown，不从最近导航、合同读取位置或 URL 猜测当前页面；Business Snapshot hash
保持不变。

### U8 LLM 协议失败安全

模型首次返回普通文本而非协议调用时，系统只允许进行有界的真实 LLM 协议修复，或诚实失败。

验收：不得用关键词、正则、文本解析、规则分类或 rule driver 把普通文本确定性转换为
`answer`、`present` 或 `navigate`；修复使用配置的真实 LLM 和当前合同工具；修复失败不会产生
业务 mutation、错误对象操作或未经授权 effect。

## Golden Story

Canonical 输入可使用以下措辞，变体只需表达相同目标，不要求逐字一致：

```text
“看看第一篇文章”
→ 客户端显示 post:first-post 详情

“总共有几篇？”
→ Assistant 根据 articles.count 回答 2
→ 客户端仍显示 post:first-post 详情
→ Assistant 不声称用户已在列表页

“我要看看列表”
→ 客户端显示 articles 集合

“我现在在哪？”
→ Assistant 根据最新 clientView 回答集合页
```

全链必须满足：

- `lastNavigation` 与 `clientView` 分别记录、分别进入 LLM 处境并可分别审计；
- Chat、Presentation 和 focus 事件具有完整 provenance；
- Business Snapshot hash 前后一致，业务 mutation、错误对象和越权 effect 增量均为 0；
- 用户结果决定通过与否，不以回答逐字快照、思维链、决策数量或工具顺序作为验收条件。

## Story Gates

- Golden Story 的真实 LLM + 浏览器 canonical 运行 100% 通过。
- 四种自然语言变体按用户结果计分，成功率至少 80%。
- U1–U8 均有至少一项机械或动态证据；U2、U7、U8 必须包含确定性机械证据。
- 任一 Safety 违规使对应运行及 Track 验收失败，不能由质量分抵消。
