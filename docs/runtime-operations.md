# Runtime Operations

## Local stack

```bash
pnpm install
pnpm dev:all
```

The managed command starts PostgreSQL through Docker Compose and runs Temporal, the Worker, and the Next.js Web app under one `concurrently` process. Do not start a second standalone Temporal or Web process on the same ports.

| Service | Address | Purpose |
|---|---|---|
| Web | `http://localhost:3100` | UI and HTTP contracts |
| Health | `http://localhost:3100/api/health` | Web + database readiness |
| Temporal | `localhost:7233` | Workflow service |
| Temporal UI | `http://localhost:8233` | Durable workflow history |
| PostgreSQL | `localhost:5433` | Append-only application truth |

Stop Web/Worker/Temporal together with `Ctrl-C`. PostgreSQL intentionally remains available; stop it with `pnpm infra:down`.

## LLM profile

The runtime accepts one complete provider-neutral profile from the environment:

```text
LLM_API_KEY
LLM_BASE_URL
LLM_MODEL
```

For development, store it in the gitignored root `.env.local`; `pnpm dev:all` passes it to Web and Worker. Missing or failed configuration makes the Assistant fail honestly. It does not select a fallback model or rule driver. Use `pnpm env:verify-dev` to verify propagation without printing values.

## Verification

```bash
curl -fsS http://localhost:3100/api/health
pnpm check
CI=true pnpm e2e
```

Real-LLM Story Evals are explicit, externally configured gates:

```bash
pnpm eval:t15
pnpm eval:t16
```

Vitest uses the isolated `ui4a_test` database unless `TEST_DATABASE_URL` overrides it. Never point tests at the development database. Test totals are deliberately not copied into documentation; the command output is authoritative.

## Storage and recovery

- `events` is the append-only truth for business, chat, audit, and Presentation event families.
- Business state is rebuilt by the Business fold.
- `presentation_user_sidecars` is a rebuildable projection, not a second source of truth.
- Temporal history is durable execution history, not business state.
- Local quarantine tables named `events_quarantine_*` or `presentation_user_sidecars_quarantine_*` are recoverable maintenance snapshots; inspect them before dropping them.

Do not truncate or rewrite the development event log as a routine restart step. When a demo reset is intentionally required, make a named quarantine copy first and report what was reset.
