# T21 Architecture — 双焦点事实与 AI-first Presentation 一致性

## 1. Boundary

```text
browser route at user send                    successful Agent/Presentation result
          │                                                   │
          ▼                                                   ▼
chat-message-appended.detail.clientView      chat-navigation-completed
          │                                                   │
          └───────────────────┬───────────────────────────────┘
                              ▼
                 pure conversation projection
                   ├─ current clientView
                   └─ lastNavigation
                              │
                              ▼
contract currentRel + both facts + provenance ──► real LLM
                                                   │
                                  answer / clarify / navigate / present
                                                   │
                              deterministic protocol validation and audit
```

Business entities, actions and authorization remain authoritative Siren/engine facts. Neither focus fact changes
Business truth or grants access.

## 2. Why Two Facts

`currentRel` is the entity fetched for the current Agent decision. It is not a browser observation.
`lastNavigation` proves the most recent successful Agent/UI4A presentation outcome. `clientView` proves what one
client reported at the instant of the current user message. Manual navigation, back/forward, refresh, delayed
receipts and multiple windows make divergence valid and informative.

The model receives all three values. The mechanical layer never chooses which one represents the user's next
intent and never silently aligns them.

## 3. Cross-Runtime Contract

The platform-neutral shapes live beside Presentation contracts in `packages/shared` and reuse `RenderSubject`.
They contain only bounded identifiers, same-origin route state, subject references and provenance ids. They cannot
carry hydrated facts, principal, policy, action, parameters or authorization.

`ClientViewReport` is request input. The server adds source message/event sequence to produce `ClientViewFact`.
`LastNavigationFact` is server-produced only.

## 4. Atomic Event Model

### Client observation

The optional report is embedded in the immutable user `chat-message-appended` detail. This keeps the raw utterance
and the view it accompanied in one append boundary. A newer user message without a report means the current
client view is unknown; the fold must not carry an older report forward.

### Navigation completion

`chat-navigation-completed` is a core audit event ignored by Business fold. Stable ids are derived from turn/step
for navigate and request id for Presentation. Only successful navigate or ready/fallback receipt with a validated
route qualifies. Fold-level idempotency is required even if storage later adds a uniqueness optimization.

## 5. Client Capture

`useChatSession` owns a hook-lifetime client instance id. Immediately before POST it reads the actual App Router
pathname/search. A pure decoder recognizes protocol-bearing `rel`, `focus` and `roots` parameters; it does not
recognize business names or natural-language phrases. A receipt id is attached only while its surface URL still
equals the observed route.

Direct routes, Canvas defaults and selection decoding reuse existing route semantics rather than a second page
inventory. When no subject can be proven, the report remains route-only/unknown.

## 6. Conversation and Agent Context

The pure conversation view retains raw message observations and folds successful navigation events. The current
turn selects the `clientView` attached to its user message; concurrent windows therefore cannot overwrite each
other through global React or server state.

Agent `DriverContext` receives `lastNavigation` and `clientView` outside legacy mutable `ConversationContext.focus`.
Prompt labels are explicit:

- current contract read location (not the browser page);
- last successful navigation/presentation;
- client-observed visible route/subject for this message.

`resolveStartRel` remains contract discovery. Client view does not mechanically rewrite it.

## 7. Presentation Ordering

Chat answer and Presentation planning remain independent as required by D27. The SSE route tracks background
Presentation promises. It may emit the Chat final result before a late receipt, but it persists a usable completion
before emitting that receipt and keeps the stream alive until tracked jobs settle. Failed planning preserves the
current client surface and does not change Chat outcome or `lastNavigation`.

## 8. LLM Protocol Policy

The real-provider probe supports `toolChoice:'required'`; this constrains only the response envelope, not which tool
the model selects. Invalid first output receives one bounded second LLM decision with the same authorized facts and
tools plus the validation class. Non-LLM code never converts rejected text into an operation. A second invalid
result is an honest, zero-effect failure.

## 9. Safety and Growth

- no keyword/regex/phrase route;
- no rule-driver product fallback;
- no second database, client registry or global current-page authority;
- no client fact in source authorization or effect gate;
- no Presentation facts in Business fold;
- no exact model wording or tool trajectory in acceptance;
- new route shapes extend the pure decoder and tests, not Chat intent branches.

## 10. Expected File Boundaries

- `packages/shared/src/`: dual-focus contracts and parser tests.
- `packages/agent/src/types.ts`, `llm-driver.ts`, `loop.ts`: driver disclosure and bounded protocol repair.
- `apps/web/src/chat/`: immutable details and pure dual-focus fold.
- `apps/web/src/app/api/chat/route.ts`: validation, append and async ordering.
- `apps/web/src/components/chat-panel.tsx`: actual client-view capture.
- `apps/web/src/db/events.ts`: core event kind only; no new table.
- `e2e/`: real Golden Story, variants, Safety and evidence.

No dependency or technology-stack change is expected.
