# T16 Red Baseline

Captured on 2026-08-23 before Presentation Plane implementation. These are observed
production-path limitations, not desired behavior or regression fixtures.

| Gap | Reproduction evidence | Story that closes it |
| --- | --- | --- |
| Focus is a fixed page rule | `canvas-body.tsx:231-239` constructs every `?focus=` request as `component: 'detail'`. | S4, S10, TS9 |
| RenderSpec is single-word | `render/spec.ts:55-62` requires one `component` and one `bind`; no regions, slots, repeat, or subtree identity exist. | S9-S11, TS10 |
| Generic detail is a raw dump | `render/words/detail.tsx:26-67` chooses node `properties.title`, iterates scalar properties, and joins `fields` as `name=value`. For `post:first-post` this makes “已发布” the heading and flattens body/title/category. | S4, TS9 |
| Thinking identity crosses turns | `chat-panel.tsx:166,267-317` keys buffered and rendered thinking only by numeric `step`. Two turns whose first model step is `1` target the same message. | S2, TS1 |
| Capability truth is stale | `llm-driver.ts:65` and `tools.ts:218-221` say render is unimplemented and forbidden, while `/api/render/catalog` and the current registry expose render words including Markdown. | S3, TS2 |
| Chat owns presentation complexity | `chat/route.ts:157-203,586-642` loads the complete word catalog, invokes render planning, freezes the spec, builds Canvas payloads, and waits for it inside the chat route. | S9, S23, TS3-TS4 |
| Keyword/rule-driven display routing | `chat/route.ts:781-925` branches on display intent, resolves concrete article focus, calls `renderSpecFor`, and only then falls through to an LLM renderer. | S10, S12, TS3, TS6 |
| Session-derived persistence risk | `frozenRenderPayload` uses `principal: user:${sessionId}` and returns `sessionId` with the frozen result (`chat/route.ts:171-203`). There is no principal/policy/subject/intent User Sidecar key or independent presentation fold. | S18, S26, TS13-TS14 |

## Executed probes

```text
rg -n "component: 'detail'|component: string|thinking === step|render 仍未实现|T2 未实现" \
  apps/web/src packages/agent/src
```

The scan found all five source anchors above. A focused current-suite run keeps the
baseline reproducible without blessing the defects as expected behavior:

```text
CI=true pnpm vitest run apps/web/src/render/spec.test.ts \
  apps/web/src/render/words/detail.test.tsx apps/web/src/components/chat-panel.test.tsx \
  packages/agent/src/llm-driver.test.ts packages/agent/src/tools.test.ts
```

The expected Red state is architectural: existing tests pass while S2-S4, S9-S12,
S18 and S23 cannot be satisfied by the current shapes. Later phases replace these
anchors with story-level positive tests and source-governance checks.
