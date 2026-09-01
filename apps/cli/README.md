# `ui4a` CLI

`ui4a` is the agent-neutral reference client for UI4A HTTP, Siren, and meta contracts. It has no
LLM, business-specific routing, approval shortcut, or independent state store.

## Install and configure

```bash
pnpm --filter @ui4a/cli build
pnpm --filter @ui4a/cli pack --pack-destination /tmp/ui4a-pack
npm install --global --prefix "$HOME/.local" /tmp/ui4a-pack/*.tgz
export PATH="$HOME/.local/bin:$PATH"

export UI4A_BASE_URL=http://localhost:3100
export UI4A_TOKEN=...              # optional only for the self-reported local demo
export UI4A_PRINCIPAL=local-user
export UI4A_POLICY_SCOPE=publishing
ui4a --json doctor
```

For a production Device credential, keep endpoint metadata in
`$XDG_CONFIG_HOME/ui4a/config.json` and keep all credential material out of the file:

```json
{
  "baseUrl": "https://ui4a.example",
  "issuer": "https://auth.ui4a.example/realms/ui4a",
  "clientId": "ui4a-cli",
  "applications": ["development"]
}
```

```bash
chmod 600 "$XDG_CONFIG_HOME/ui4a/config.json"
ui4a auth login
ui4a --json auth status
ui4a --json doctor
ui4a auth logout
```

`auth login` opens Keycloak Device Authorization in the browser. The offline/refresh credential is
stored only in macOS Keychain; each command refreshes a memory-only access token and atomically stores
the returned refresh rotation. Long refresh tokens use generation-scoped bounded Keychain chunks and
an atomic manifest pointer; no plaintext credential file is created. `auth logout` revokes the offline credential before deleting the
Keychain item. The CLI client never receives `ui4a:approve`.

Config precedence is one-off `--base-url`/`--token`, then `UI4A_*` environment variables, then
`$XDG_CONFIG_HOME/ui4a/config.json`, then the localhost demo defaults. Tokens are sent as Bearer
credentials and never returned. The current local server reports `self-reported-local-demo`; do not
treat it as production authentication.

Device endpoint environment keys are `UI4A_ISSUER`, `UI4A_CLIENT_ID`, and comma-separated
`UI4A_APPLICATIONS`. `--token`/`UI4A_TOKEN` remains a one-off external Bearer path and takes precedence
over Keychain; never persist an offline credential in configuration or shell history.

## Stable JSON

`--json` writes only a versioned envelope to stdout:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "entities.get",
  "data": {},
  "meta": { "cliVersion": "0.1.0", "requestId": "..." }
}
```

Errors include `code`, `message`, optional `status/details`, `retryable`, and `requestId`. Exit codes:
0 success, 2 usage, 3 config, 4 auth, 5 not found, 6 judgment/schema, 7 conflict/stale, 8 network/
service, 9 protocol/internal.

## Common paths

```bash
ui4a --json apps list
ui4a --json entities get post:first-post
ui4a --json actions exec post:first-post unpublish --params '{}' --dry-run
ui4a --json bundles export publishing --out /tmp/publishing.json
ui4a --json drafts create --kind flow-definition --target post-status \
  --payload-file /tmp/flow.json --command-id agent-change-1
ui4a --json drafts validate <draft-id>
ui4a --json drafts diff <draft-id>
ui4a --json drafts submit <draft-id>
ui4a --json audit draft <draft-id> --after-seq 0 --limit 20
```

`actions exec` reads the current Entity before writing. `--dry-run` never calls the write endpoint.
Draft validation and activation rules live on the server. Human approval is intentionally absent;
even generic action execution refuses confirmation/activation approval. `request` supports only
same-origin GET/HEAD, rejects redirects, and bounds responses to 1 MiB.
