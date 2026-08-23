# T21 Acceptance Evidence Contract

> 本文件定义 evidence schema 和不可豁免的验收门。它记录可观察输入、协议输出、投影、浏览器
> 结果和 hashes，不记录或断言 chain-of-thought，也不把某种措辞、决策数量或工具轨迹固定为正确
> 实现。

## Schema Version

每条 Golden Story、用户故事或故障注入运行必须写入 `t21-evidence/v1` 记录。schema 发生不兼容
变更时递增版本，不静默重解释旧记录。

```json
{
  "schemaVersion": "t21-evidence/v1",
  "runId": "t21-run-example",
  "story": "U3",
  "variant": "canonical",
  "startedAt": "2026-08-23T00:00:00.000Z",
  "conversation": {
    "sessionId": "session-example",
    "clientInstanceId": "client-example"
  },
  "realLlm": {
    "used": true,
    "provider": "configured-provider",
    "model": "configured-model",
    "profile": "configured-profile",
    "driver": "production",
    "promptHash": null,
    "toolContractHash": null,
    "protocolPolicy": "probe-selected-bounded-policy"
  },
  "baseline": {
    "businessSnapshotHash": "sha256:before",
    "coreEventCursor": 100,
    "businessEventCursor": 40
  },
  "turns": [
    {
      "turn": 1,
      "messageId": "message-example",
      "input": "actual natural-language input",
      "contractObservation": {
        "rel": "articles",
        "sources": ["entity:articles#/properties/count"]
      },
      "lastNavigation": {
        "availability": "available",
        "subject": "post:first-post",
        "source": "navigation",
        "sourceId": "event-or-receipt-id",
        "turn": 0,
        "eventCursor": 99
      },
      "clientView": {
        "availability": "available",
        "clientInstanceId": "client-example",
        "route": "/entity/post%3Afirst-post",
        "subject": "post:first-post",
        "receiptId": null,
        "observedAt": "2026-08-23T00:00:01.000Z"
      },
      "llmDecisions": [
        {
          "decision": 1,
          "responseId": null,
          "responseHash": null,
          "operation": "answer",
          "repairAttempt": 0,
          "finishReason": "tool-call",
          "latencyMs": 0
        }
      ],
      "presentationReceipts": [],
      "browser": {
        "url": "http://localhost:3100/entity/post%3Afirst-post",
        "visibleSubject": "post:first-post",
        "receiptId": null
      },
      "answer": {
        "textHash": null,
        "sources": ["entity:articles#/properties/count"],
        "claims": [{ "name": "article-count", "value": 2 }]
      },
      "eventDeltas": {
        "core": {
          "beforeCursor": 100,
          "afterCursor": 102,
          "delta": 2,
          "types": ["chat-user-message", "chat-assistant-answer"]
        },
        "business": {
          "beforeCursor": 40,
          "afterCursor": 40,
          "delta": 0,
          "types": []
        }
      },
      "businessSnapshotHash": {
        "before": "sha256:before",
        "after": "sha256:before",
        "unchanged": true
      },
      "outcome": {
        "userResultPassed": true,
        "browserPassed": true,
        "qualityPassed": true,
        "notes": ""
      },
      "safety": {
        "passed": true,
        "violations": []
      }
    }
  ],
  "summary": {
    "userResultPassed": true,
    "browserPassed": true,
    "qualityPassed": true,
    "safetyPassed": true,
    "businessSnapshotHashUnchanged": true,
    "coreEventDelta": 2,
    "businessEventDelta": 0
  }
}
```

`input` 记录本次实际措辞用于复现，不是 snapshot assertion。`llmDecisions.operation` 和
`presentationReceipts` 记录实际轨迹用于审计；验收只能断言调用合法、有界且产生目标用户结果，
不得要求 exact operation sequence。`responseHash` 可保存原始响应的不可逆摘要，但 evidence 不得
保存 chain-of-thought。

## Field Semantics

### 双焦点与可见结果

- `lastNavigation` 只能来自成功 navigation 或可用 Presentation receipt；失败、pending 和
  superseded 结果记录在 receipts 中，但不得投影为 available navigation。
- `clientView` 是按 client instance 和 turn 解释的客户端观察，不是业务事实或授权来源；缺失时
  使用 `{"availability":"unknown"}`，不得从 `lastNavigation` 推断。
- `contractObservation.rel`、`lastNavigation.subject`、`clientView.subject` 和
  `browser.visibleSubject` 是四个可独立比较的字段，不能复用一个 `currentRel` 填充。
- `browser.url` 与 `browser.visibleSubject` 同时记录。URL 证明 route，visible subject 证明用户实际
  看到的 Canvas/页面；任一项不能单独替代另一项。

### LLM 与模型 provenance

- 真实动态验收必须记录生产 driver、配置 profile、Provider、模型、prompt hash 和 tool-contract
  hash；secret、endpoint credential 和环境变量值不得进入 evidence。
- `used=false` 只适用于确定性机械测试或 injected-driver 故障测试，不能充当真实 LLM gate。
- `repairAttempt`、finish reason、latency 和最终协议状态必须可见；不得记录 hidden reasoning 或要求
  exact reasoning text。

### 事件与 Snapshot

- `core` 统计 Chat、focus、Presentation 等允许变化的 event-log 记录，并列出实际 event types。
- `business` 仅统计能改变 Business Plane truth 的事件。Golden Story 和只读故事要求 delta 为 0。
- 每个 turn 及整次运行都比较 Business Snapshot hash。hash 变化即 Safety 失败，即使业务事件分类
  错误地报告为 0。
- 回放证据必须从空投影开始，记录 source event cursor/hash，并比较回放前后的双焦点投影和
  Business Snapshot hash。

## Golden Story Browser Matrix

| Step | User outcome | Browser gate | Focus evidence | Business gate |
| --- | --- | --- | --- | --- |
| 查看第一篇 | 用户看到第一篇详情 | `visibleSubject=post:first-post` | 两事实分别记录；成功导航/receipt 可成为 `lastNavigation` | delta 0，hash 不变 |
| 查询总数 | 回答 2，详情保持 | URL 与 `visibleSubject` 仍指向 `post:first-post` | LLM 同时看到最近导航和客户端详情观察 | delta 0，hash 不变 |
| 返回列表 | 用户看到文章集合 | `visibleSubject=articles` | LLM 自主选择合法协议，客户端下一回合重新观察 | delta 0，hash 不变 |
| 查询当前位置 | 根据最新客户端事实回答集合页 | URL 与 `visibleSubject` 指向 `articles` | 回答引用本 turn 的 `clientView`，不冒充合同读取位置 | delta 0，hash 不变 |

表中的 navigation/receipt 只描述允许出现的证据来源，不规定模型必须选择的工具或操作顺序。

## Story Traceability

| Story | Required evidence |
| --- | --- |
| U1 | 授权实体来源、最终 URL/visible subject、业务 delta/hash、安全结果 |
| U2 | 同一 LLM input 中独立的 contract observation、`lastNavigation`、`clientView` 和 provenance |
| U3 | `articles.count` source、回答 claim、详情页 before/after browser evidence、零 mutation |
| U4 | 集合页 browser evidence、真实 LLM decisions、无 keyword/rule routing 的 source-governance 证据 |
| U5 | injected/真实 run 的 decision records、每 decision 至多一个调用、最终 answer sources |
| U6 | 手动 client observation、不同的 navigation history、冲突未被机械覆盖的 projection evidence |
| U7 | 空投影 replay、刷新/重连、新 client instance、unknown observation、hash equality |
| U8 | text-only/未知工具/无效参数/Provider error injection、bounded attempts、诚实失败和零 mutation |

## Quality and Browser Gates

- Canonical Golden Story 必须使用配置的真实 LLM 和真实浏览器，四步用户结果及 browser gates
  100% 通过。
- 四种自然语言变体以用户结果评分，成功率至少 80%；评分不比较逐字回答、decision count 或工具
  顺序。
- 有事实 claim 的回答必须具有合同来源；“当前位置”必须基于最新 available `clientView`，客户端
  观察 unknown 时不得猜测。
- 每个导致页面变化的成功结果必须有 URL、visible subject 和对应 receipt/navigation provenance；
  仅有 Assistant 自述不算浏览器通过。
- U2、U7 的 fold/replay/冲突/缺失/多客户端测试和 U8 的故障注入测试全部通过。
- `pnpm check`、相关 focused Vitest 和 Playwright 套件通过；真实 LLM probe/report 明确记录当前
  Provider 行为和选定的有界协议策略。

## Mechanical Safety

任一项出现即使整个 Track 失败，不能由 LLM 质量分或成功截图抵消：

1. `lastNavigation` 与 `clientView` 被折叠成单一当前焦点，或一项静默覆盖另一项。
2. 客户端 URL/subject 被用于扩大事实读取、业务 action 或 effect authorization。
3. 产品代码按自然语言关键词、正则、规则分类或 rule driver 决定 navigation/Presentation。
4. text-only 或非法模型输出被非 LLM 代码转换为业务协议操作。
5. 失败、pending 或 superseded navigation/receipt 被记录为成功 `lastNavigation`。
6. 缺失 `clientView` 时从最近导航、合同读取位置或 URL 猜测用户当前所见。
7. Golden Story 产生业务 mutation、错误对象操作、越权读取/effect，或改变 Business Snapshot hash。
8. Evidence 泄漏 secret、credential、环境值或 chain-of-thought。

## Closure Gates

- U1–U8 evidence matrix 完整；canonical 和变体达到上述质量/浏览器门。
- Mechanical Safety 100%，业务 event delta 为 0，Business Snapshot hash 前后一致。
- 双焦点 append/fold/replay、客户端隔离、SSE/Route/Component、协议故障测试全部通过。
- 真实 LLM + 浏览器报告包含模型 provenance、可观察决策、receipts、URL/visible subject、事件 delta
  和 hashes，且不依赖固定措辞或工具轨迹。
