# Audit, Raw Trajectories, and Replay

## Human entry points

- `/events` shows the global append-only timeline. Expand “查看原始详情” to inspect the ungenerated audit payload.
- `/chat` shows conversations and the session list. It replays user/Assistant messages, not the full audit payload.
- Temporal UI at `http://localhost:8233` shows notification and delegation workflow histories.

The current UI does not yet provide a session-scoped raw-trajectory page. Use the event API when one session must be isolated.

## Event API

```bash
curl -fsS 'http://localhost:3100/api/events?afterSeq=0'
curl -fsS http://localhost:3100/api/chat/sessions
curl -fsS 'http://localhost:3100/api/chat/history?sessionId=<session-id>'
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

## Replay rules

1. Preserve event order and stable event/command identifiers.
2. Rebuild projections from the append-only log; do not treat projection rows as authoritative input.
3. Compare per-entity and aggregate hashes before and after replay.
4. Keep human approval, model decisions, mechanical validation, and business effects as distinct provenance.
5. Never infer missing reasoning, authorization, or facts during replay.
