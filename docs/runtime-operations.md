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

## Meta Human Control Plane

Open `http://localhost:3100/meta`. The page reads `/_meta/.well-known/ui4a.json`, shows the server-
authorized scope selector, and discovers all collection/self surfaces dynamically. Human deep links use
`/meta/entity?rel=<encoded>&scope=<authorized>`; unknown scope returns 403 and cross-scope exact reads remain
indistinguishable from absence. The local demo visibly reports `self-reported-local-demo`; it is not SSO.

Application is read-only. Draft/Activation controls come from the current Siren entity, reread before POST,
and never accept browser actor/principal overrides. Invalid Draft repair is a structured issue-focused RJSF
form; raw contract remains a collapsed audit view. If a decision reports stale/CAS conflict, retain the URL,
refresh the entity, review the new diff/checks, and decide again.

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
pnpm eval:t17
pnpm eval:t18
pnpm eval:t19:writing
pnpm eval:t19:authoring
```

## Coding executor profile

Coding execution is separately configured from the conversational LLM. The Application names only
an executor class/profile requirement; deployment data selects the provider and repository:

```text
UI4A_CODING_EXECUTOR_PROFILES=[{"name":"codex-default","executorClass":"coding-agent","providerId":"codex","transport":"sdk","workspaceBackend":"isolated-worktree","sandbox":"workspace-write","timeoutSeconds":300,"maxTurns":20,"envAllowlist":["PATH","HOME","CODEX_HOME"],"networkPolicy":"none"}]
UI4A_CODING_REPOSITORIES={"ui4a":{"path":"/absolute/repository","scopes":["development"],"allowedPaths":["apps","packages"]}}
UI4A_CODING_WORKSPACE_ROOT=/absolute/ui4a-owned-workspaces
UI4A_CAPABILITY_CALLBACK_TOKEN=<deployment-secret>
UI4A_PUBLIC_BASE_URL=http://localhost:3100
```

`pnpm eval:t18` uses disposable repositories, the isolated test database, and the installed/authenticated
Codex SDK/CLI. It records `eval-report.json`; it never points the executor at this repository. Missing
profile, provider, authentication, or repository registration fails without fallback or workspace writes.

## Writing and Agent Definition Authoring profiles

These specializations are configured separately from Chat and Coding. Applications expose only class/profile
requirements; deployment owns model, endpoint, credential environment name, roots, and budgets.

```text
UI4A_DOCUMENT_AGENT_PROFILES=[{"name":"editorial-default","runtimeClass":"document-agent","providerId":"codex","transport":"sdk","model":"<deployment-model>","apiKeyEnv":"LLM_API_KEY","artifactBackend":"isolated-document-workspace","timeoutSeconds":240,"maxTurns":18,"envAllowlist":["PATH","HOME","CODEX_HOME"],"networkPolicy":"none"}]
UI4A_DOCUMENT_WORKSPACE_ROOT=/absolute/ui4a-document-workspaces
UI4A_AGENT_AUTHORING_PROFILES=[{"name":"authoring-default","runtimeClass":"agent-definition-authoring","providerId":"codex","transport":"sdk","model":"<deployment-model>","apiKeyEnv":"LLM_API_KEY","timeoutSeconds":240,"maxTurns":18,"envAllowlist":["PATH","HOME","CODEX_HOME"],"networkPolicy":"none"}]
UI4A_AGENT_AUTHORING_RUNTIME_ROOT=/absolute/ui4a-authoring-runs
```

An optional `endpoint` belongs only in these server-owned profiles. Writing allows only the isolated document
workspace and never publishes. Authoring uses a read-only empty runtime and only creates a Governed Draft.

## External Agent CLI

```bash
pnpm cli:build
pnpm --filter @ui4a/cli pack --pack-destination /tmp/ui4a-pack
npm install --global --prefix "$HOME/.local" /tmp/ui4a-pack/*.tgz
ui4a --json doctor
```

Configure `UI4A_BASE_URL`, `UI4A_TOKEN`, `UI4A_PRINCIPAL`, and `UI4A_POLICY_SCOPE`. The local demo
may run without a token and reports `self-reported-local-demo`; this is not production auth. See
`apps/cli/README.md` for discovery, action, Bundle, Draft, audit and read-only request commands.

Vitest uses the isolated `ui4a_test` database unless `TEST_DATABASE_URL` overrides it. Never point tests at the development database. Test totals are deliberately not copied into documentation; the command output is authoritative.

## Storage and recovery

- `events` is the append-only truth for business, chat, audit, and Presentation event families.
- Business state is rebuilt by the Business fold.
- `presentation_user_sidecars` is a rebuildable projection, not a second source of truth.
- `domain='draft'` lifecycle events are truth; `draft_payloads` is immutable content-addressed data
  and `draft_projection` is rebuildable. Draft events never enter the Business fold.
- Temporal history is durable execution history, not business state.
- `domain='capability'` Run events are truth; `capability_payloads` stores immutable raw/patch/trajectory
  payloads and `capability_run_projection` is rebuildable. UI4A-owned worktrees are retained through the
  human result decision; acceptance records a receipt and does not modify the main checkout.
- Canonical Agent Run and Agent Definition events are truth for specialized execution and registry versions;
  their projections are rebuildable. An old Run retains its birth-pinned definition/prompt/runtime references.
- Local quarantine tables named `events_quarantine_*` or `presentation_user_sidecars_quarantine_*` are recoverable maintenance snapshots; inspect them before dropping them.
- Temporal integration tests use isolated `UI4A_TASK_QUEUE`/`UI4A_WORKFLOW_PREFIX`; do not run a
  test worker on the development queue.

Do not truncate or rewrite the development event log as a routine restart step. When a demo reset is intentionally required, make a named quarantine copy first and report what was reset.
