# T21 Disposable Dual-Focus Contract Probe

This read-only probe compared how the existing Chat, conversation fold, SSE, Presentation receipt,
Canvas navigation, direct-page and session-restoration paths could carry the two approved facts. It
made no repository or database change.

## Compared shapes

### A. Reuse `ConversationFocus`

Write navigation and client observations through the existing `chat-context-updated.patch.focus`.

Rejected because one mutable `currentRel` cannot retain two conflicting facts. The patch is a
derived interpretation with `basedOnSeq` replacement semantics, while a client observation is an
immutable fact attached to a particular user turn. It would preserve the defect under a new name.

### B. Two dedicated event families

Append one client-view event and one navigation-completion event.

Rejected for `clientView`: the user message and its current view would require two writes. A failure
between them could inject the user turn into the LLM with an older view, or leave an observation
whose source message was never appended. A separate navigation event remains appropriate because a
successful navigation or async receipt happens after the user message.

### C. Hybrid immutable observation plus completion event

Selected:

- store `clientView` inside the immutable user `chat-message-appended` detail;
- store each successful Agent navigation or usable Presentation receipt as a dedicated core
  `chat-navigation-completed` event under `rel=chat:<sessionId>`;
- fold them into explicit `clientView` and `lastNavigation` prompt facts; do not reuse or rename
  `ConversationFocus.currentRel`.

This aligns each fact with its real atomic boundary and reuses the existing append-only event log.

## Selected semantics

### Client view observation

At send time the client snapshots:

- a hook-lifetime `clientInstanceId`;
- the actual `pathname + search`;
- a mechanically decoded single subject or selection when the route carries `rel`, `focus`, or
  `roots`;
- an optional Presentation request id only while the current URL still equals that receipt's
  surface URL.

The route bounds and validates this value before appending the user message. It is not used to
authorize entity reads, actions or effects. The conversation fold exposes only the observation
attached to the current/latest user message. If that message has no observation, `clientView` is
unknown; an older client's view is never carried forward.

### Last navigation completion

`chat-navigation-completed` records:

- `sessionId`, `turnId` and a stable `navigationId`;
- source kind `agent-navigate` or `presentation-receipt`;
- subject/selection and resulting route;
- step or Presentation request id and source message ids.

Only a successful `navigate`, or a `ready`/`fallback` Presentation receipt with a valid surface URL,
is appendable. Pending, failed and superseded results remain receipt/step evidence but do not move
`lastNavigation`. The fold deduplicates `navigationId` and selects the latest successful completion
by event sequence.

### Async ordering

The current Presentation call is fire-and-forget. The route should track receipt promises and, for
a usable receipt, durably append the completion before emitting that receipt to the client. Chat
answer computation remains independent; the SSE may emit `final` first but must remain open until
tracked Presentation jobs settle, so a client cannot navigate from a receipt that the next turn
cannot yet recover.

## Primary touchpoints

- `packages/shared/src/`: small cross-runtime client-view/navigation fact shapes reusing the existing
  Presentation subject/receipt contracts.
- `apps/web/src/chat/history.ts`: immutable observation and completion detail types.
- `apps/web/src/chat/conversation.ts`: independent fold/replay and unknown behavior.
- `apps/web/src/db/events.ts`: core event kind.
- `apps/web/src/app/api/chat/route.ts`: request validation, atomic user-message append, navigation
  completion append, async receipt ordering and Agent context projection.
- `packages/agent/src/types.ts`: two explicit, non-authoritative driver facts outside the legacy
  mutable `ConversationContext.focus`.
- `packages/agent/src/llm-driver.ts`: bounded prompt disclosure with distinct labels.
- `apps/web/src/components/chat-panel.tsx`: hook-lifetime client identity and synchronous route
  observation at send.
- `apps/web/src/chat/sse.ts`: existing receipt/focus protocol remains the client navigation carrier;
  no new business operation is introduced.

## Required Red→Green tests

1. Message parsing accepts a bounded view, rejects malformed/oversized values, and accepts omission
   as unknown.
2. A current user message without a view clears the projected current client observation instead of
   inheriting an older one.
3. Two client instances in one session retain immutable per-message observations; the current turn
   sees its own instance only.
4. Duplicate/out-of-order navigation ids fold idempotently by event sequence.
5. Failed/pending/superseded navigation or receipt never changes `lastNavigation`.
6. Direct `rel`, Canvas `focus`, selection `roots`, refresh and restored-session routes produce
   bounded observations without natural-language routing.
7. A usable async Presentation completion is persisted before its receipt becomes client-visible.
8. Agent prompts contain contract `currentRel`, `lastNavigation` and `clientView` as three separately
   labeled values.
9. Forged client subjects do not add entity observations, action tools or effect authorization.
10. Empty replay reconstructs the same two facts and leaves the Business Snapshot hash unchanged.

## Decision input

Phase A architecture should adopt the hybrid shape. It is the smallest design that preserves both
facts, has no message/view atomicity gap, supports async Presentation provenance, keeps missing
client state honest, and avoids a second store or deterministic intent router.
