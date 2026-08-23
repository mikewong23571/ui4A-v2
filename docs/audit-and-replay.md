# Audit, Raw Trajectories, and Replay

## Human entry points

- `/events` shows the global append-only timeline. Expand “查看原始详情” to inspect the ungenerated audit payload.
- `/chat` shows conversations and the session list. It replays user/Assistant messages, not the full audit payload.
- Temporal UI at `http://localhost:8233` shows notification, delegation, and Capability Run workflow histories.

The current UI does not yet provide a session-scoped raw-trajectory page. Use the event API when one session must be isolated.

## Event API

```bash
curl -fsS 'http://localhost:3100/api/events?afterSeq=0'
curl -fsS http://localhost:3100/api/chat/sessions
curl -fsS 'http://localhost:3100/api/chat/history?sessionId=<session-id>'
```

The event endpoint is bounded (`limit` 1–100, default 100) and supports `domain`, `rel`, `kind`,
and `principal` filters. It returns `page.hasMore` and `page.nextAfterSeq`. Equivalent CLI reads:

```bash
ui4a --json audit session <session-id> --after-seq 0 --limit 20
ui4a --json audit draft <draft-id> --after-seq 0 --limit 20
```

Example session filter:

```bash
curl -fsS 'http://localhost:3100/api/events?afterSeq=0' |
  jq '[.events[] | select(.rel == "chat:<session-id>")]'
```

## Chat trajectory event family

| Kind | Raw evidence |
|---|---|
| `chat-message-appended` | User or Assistant original text and provenance |
| `chat-turn-started` | Goal, mode, driver, sessionId, and turnId |
| `agent-decision` | Exact system/user prompt, model reasoning when exposed, chosen protocol operation, and step |
| `chat-turn-progress` | Step rel, operation, outcome, sources, and visible message |
| `chat-context-updated` | Mechanically projected active goal, focus, referents, constraints, and effect authorization |
| `chat-turn` | Final outcome, summary, steps, successes, and Presentation request references |

Visible `thinking` is a live SSE projection. Refresh restores durable messages but deliberately does not attach old thinking to a later turn. The durable `agent-decision.detail.reasoning` field is the audit source when the configured provider returned reasoning; otherwise it is `null`.

## Business and Presentation separation

Business events include declared effects, rejections, confirmation decisions, plan execution, definition lifecycle, and capability/delegation state. Presentation events include request/receipt, Recipe promotion, Sidecar instantiate/revise/pin/stale/revert, and hydration decisions.

Both families may share the PostgreSQL table, but `domain='presentation'` events must never enter the Business fold. Misrouting fails closed. Rebuilding the Sidecar projection must not change the Business Snapshot hash.

Draft events use `domain='draft'` and fold into Draft aggregates only. Exact authorized reads
dereference immutable `draft_payloads`; ordinary audit/list responses do not include candidate
payloads. Human acceptance writes one core `definition-candidate-applied` event and one
`draft-accepted` event in the same transaction, preventing a half-activation.

Coding execution uses `domain='capability'`. `capability-run:<id>` is the owner/scope-authorized summary;
normalized progress, raw chunk receipts, patch, trajectory, test observations, profile/session provenance,
and source Flow links remain separate from the Business fold. Raw payloads live in immutable
`capability_payloads` and are dereferenced only by exact authorized reads. A succeeded Run is still a
proposal: Agent acceptance is rejected, while a human accept/reject event stores a non-merge receipt after
base/path/test/hash revalidation.

Canonical specialized execution uses the Agent Run event family and `agent-run:<id>` Siren projection. Each Run
stores birth-pinned definition, Prompt, runtime profile, task/result contract hashes, source action, cursor,
questions/grant decisions, result/evidence/artifact references, restarts, cancellation, and terminal callback.
Raw Provider frames are content-addressed and visible only through exact owner/scope-authorized reads. Legacy T18
Capability Runs are decoded into this model for compatibility; their old wire endpoints remain available.

Agent Definition authoring results additionally link to an `agent-definition` Draft. Provider validation claims are
audit data, not authority: the Draft service independently recalculates parse/invariant checks, diff, and Eval
availability. Invalid candidates remain revisable; only a human approval event can register and activate a version.

## Replay rules

1. Preserve event order and stable event/command identifiers.
2. Rebuild projections from the append-only log; do not treat projection rows as authoritative input.
3. Compare per-entity and aggregate hashes before and after replay.
4. Keep human approval, model decisions, mechanical validation, and business effects as distinct provenance.
5. Never infer missing reasoning, authorization, or facts during replay.
6. Rebuild Capability Run projections from capability events and re-hash payloads; never treat a provider's
   final prose, projection row, or Temporal status as the accepted code result.
7. Rebuild Agent Definition, Agent Run, and Draft projections independently; an old Run keeps its birth version
   even when a newer definition becomes active.
