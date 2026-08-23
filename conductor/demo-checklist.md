# UI4A v2 — 人工 Demo 走查清单

> 用途:GOAL 定义 DONE = 自动化验收 + **一次人工 demo 走查**。本清单是那次走查的脚本(约 15–20 分钟)。
> 自动化部分已全部通过(证据见 [done-report.md](./done-report.md));这里只走"只能人来感受"的部分,包括 GOAL 的四个人工评估点。

## 0. 起栈(2 分钟)

```bash
cd /Users/mike/projs/playground/ui4A-v2
pnpm dev:all
```

打开 <http://localhost:3100>:应看到态势投影(待确认/在飞委托/文章数)+ 最近事件时间线 + 各入口。
`curl localhost:3100/api/health` 应为 `{"status":"ok","db":"ok"}`。

> LLM profile 由根目录 gitignored `.env.local` 的 `LLM_API_KEY/LLM_BASE_URL/LLM_MODEL` 提供。Assistant 无配置或调用失败时诚实失败，不 fallback 到 rule driver；人工 Renderer 保持可用。

## 1. B 场景双执行者(5 分钟)

| # | 路径 | 操作 | 预期 |
|---|---|---|---|
| B1-人 | renderer | 首页 → "+ 发布向导入口" → 三步表单逐字段填 → ready 点"发布" | 列表出现新文章;态势文章数 +1 |
| B1-agent | 合同 | 右下悬浮聊天 → 开"委托"开关 → 输入"帮我发布一篇文章" | 派发回执;舰队页(/delegations)看进度变绿;文章 +1 |
| B2-人 | renderer | 文章列表点进一篇 → 点"下线" | 该篇转"已下线",其余不动 |
| B3-人 | renderer | 评论队列 → 逐条"通过" | 待处理清零 |

## 2. S1 确认门(2 分钟)

1. 让 agent 做高风险动作:聊天(inline,不开委托)输入"把 post-welcome 归档"(或自己用 curl:见 done-report S1 行)。
2. **预期:文章未被归档**;首页收件箱出现待确认 1;点进 → 看到提议者(agent)/目标动作/信道。
3. 点"批准" → 文章转 archived;事件流页(/events)可看到 confirmation-approved(actor=human)。
4. **人工评估点 ①(确认疲劳)**:这个确认气泡的信息量够不够你下判断?多来几次会不会烦?(记到下面的观察区)

## 3. S2 定义平面 BIOS(3 分钟)

1. 打开 `/meta`(BIOS):看 flow 定义(文章发布向导/状态机)。
2. `/meta/activations` 激活队列:若空,用 agent 造一个(聊天:"在 post-status 的 published 节点加一个 highlight 动作"——agent 会走 /_meta 修订;或 curl 序列见 done-report)。
3. **机械 diff 页**:看到结构化 diff(绿行新增)与六项检查;点批准。
4. **人工评估点 ②(diff 可读性)**:这个 diff 你敢不敢批?格式上还缺什么?
5. 批准后:首页正常发的新文章立即多出 `highlight` 动作——**没有改任何 prompt**。

## 4. T16 Presentation 画布(3 分钟)

1. 打开 `/canvas?focus=post%3Afirst-post`：标题、状态、正文、元数据、actions 和 links 应层次分明，主体验不得是原始 fields dump。
2. 使用“切换疏密”“收起/展开视图”“为什么这样展示”，确认每次都有版本或解释反馈。
3. 选择“以后都这样看”，刷新或从另一 Chat Session 返回；应命中同一用户级 Sidecar，并显示当前事实。
4. 打开 `/canvas`：两篇文章各出现一次，且两次交互内可进入目标文章。
5. **人工评估点 ③(Sidecar 稳定性)**：跨刷新是否稳定、事实是否新鲜、优化反馈是否清楚？

## 5. S4 计划 & 舰队(2 分钟)

1. 舰队页 /delegations:看到历史委托(状态/步数/成功数)。
2. Temporal UI <http://localhost:8233>:workflow 列表能看到 delegation-*/notify-* 的事件历史(轨迹即事件历史)。

## 6. 原始轨迹(1 分钟)

1. 完成一次 Chat 后打开 `/events`。
2. 找到 `chat:<sessionId>` 相关事件，展开“查看原始详情”。
3. 检查 `chat-message-appended → chat-turn-started → agent-decision → chat-turn-progress → chat-turn`。
4. `agent-decision` 应包含实际 prompt、reasoning（provider 提供时）与最终协议 operation；缺失 reasoning 必须为 `null`，不得补造。

## 7. 观察记录区(走查时填写)

- 确认疲劳:
- 澄清对话收敛体验(如聊天中字段澄清):
- 机械 diff 可读性:
- Sidecar 稳定性:

## 已知限制(走查前应知)

- 事件日志的 actor/principal 为自报口径(D8);Keycloak/真实 SSO 按 GOAL 明文排除(D10);
- LLM provider/model 完全由外部 profile 决定；reasoning 是否可见取决于 provider，实际模型和每步时延以事件证据为准;
- S3 并发演示的载体是"同标题并发发布"(title-not-taken 世界状态型 guard),不是评论并发(spec 头注有记录);
- App 创建暂不在产品内闭环；外置 Agent authoring 方向见 `GOAL.md`。
- 完整验收命令:`pnpm check`、`CI=true pnpm e2e`，实际数量和时长以现场输出为准。
