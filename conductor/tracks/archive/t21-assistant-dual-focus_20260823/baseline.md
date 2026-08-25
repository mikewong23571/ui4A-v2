# T21 Red Baseline

Captured on 2026-08-23 against the configured real `deepseek-v4-flash` runtime and the running local
stack at `http://localhost:3100`. This is observed production-path evidence, not desired behavior or
a fixture that blesses the defect.

## Automated reproduction

A fresh Chat session (`t21-red-1787499451381`) submitted five read-only turns. The probe consumed
the actual SSE protocol and reduced `focus`/ready Presentation frames with the same visible-subject
semantics as the client. It did not call `/api/exec`, mutate application data, or print provider
credentials.

| Turn | Input | Agent outcome | Step rel | Focus/ready receipt | Reduced visible subject |
| ---: | --- | --- | --- | --- | --- |
| 1 | 看看第一篇文章 | answered | `articles` | none | `articles` |
| 2 | 详情 | answered | `articles` | none | `articles` |
| 3 | 总共有几篇？ | answered (`2`) | `articles` | none | `articles` |
| 4 | 我要看看列表 | failed: text-only output | `articles` | none | `articles` |
| 5 | 我现在在哪？ | failed: text-only output | `articles` | none | `articles` |

The canonical U1 result is already Red: “看看第一篇文章” returns correct text but does not make
`post:first-post` visible. The same run also reproduces the protocol failure from the reported
session: the model forms a correct list/location answer as text, while `toolChoice:auto` yields no
tool call and the fail-safe rejects it.

## Audit assertions

The installed CLI read the exact session through the governed audit endpoint. Mechanical assertions
proved:

- zero `chat-context-updated` events;
- every decision prompt serialized the structured conversation situation as `{}`;
- no decision prompt contained `clientView` or `lastNavigation`;
- all five decisions labeled the request-scoped contract entity as `articles`;
- turns 4 and 5 became `fail` operations after text-only model output.

Compact audited decision projection:

```json
[
  { "goal": "看看第一篇文章", "step": 1, "op": "answer", "currentRel": "articles" },
  { "goal": "详情", "step": 1, "op": "answer", "currentRel": "articles" },
  { "goal": "总共有几篇？", "step": 1, "op": "answer", "currentRel": "articles" },
  { "goal": "我要看看列表", "step": 1, "op": "fail", "currentRel": "articles" },
  { "goal": "我现在在哪？", "step": 1, "op": "fail", "currentRel": "articles" }
]
```

The audit assertion is repeatable for a captured session with:

```bash
UI4A_PRINCIPAL='user:<session-id>' node apps/cli/dist/main.js --json \
  audit session <session-id> --limit 100 | jq -e '<dual-focus red assertions>'
```

## Source anchors

- `apps/web/src/app/api/chat/route.ts` recalculates `startRel` from each goal and defaults to
  `articles`; it does not consume a client view.
- The same route sends a browser `focus` frame only after successful `navigate` or effect refresh.
- `apps/web/src/components/chat-panel.tsx` changes the Canvas URL only after such a focus or ready
  Presentation receipt.
- `apps/web/src/app/api/chat/route.ts` writes structured conversation context only for a pending
  clarification, so successful navigation and presentation do not populate the next turn.
- `packages/agent/src/navigation.ts` excludes the request-scoped current rel from the navigation
  enum, even if the browser is visibly elsewhere.
- `packages/agent/src/llm-driver.ts` uses provider `toolChoice:auto` and converts a text-only result
  directly to a fail-safe operation.

## Red condition to close

Later phases must replace this baseline with positive U1–U8 tests. The Golden Story is Green only
when the LLM sees separate `lastNavigation` and `clientView` facts, the browser reaches the intended
subject without phrase routing, text-only protocol failure is handled by the probe-selected bounded
policy, and the Business Snapshot hash remains unchanged.
