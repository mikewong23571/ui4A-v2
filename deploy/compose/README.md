# T22 Compose operator inputs

The Compose production input generator validates operator-owned files; it does not create or print
credentials. Prepare one canonical settings JSON, one canonical deployment Secret JSON, and the
eight independently mounted password files plus the callback credential file referenced by
`compose.yaml`. Every file and the input
manifest must be an absolute, non-symlink regular file with mode `0600`.

The manifest contains `ui4aGitSha`, paths, and nine digest-pinned image references only. The three
UI4A OCI revisions must equal `ui4aGitSha`; the operator checkout may be newer, but that release
commit must exist and be an ancestor of the checkout `HEAD`. Validate it without starting the stack:

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
compose_inputs_json="$(pnpm exec tsx scripts/t22-compose-inputs.ts generate --manifest /absolute/private/compose-inputs.json)"
eval "$(printf '%s' "$compose_inputs_json" | jq -r '.environment | to_entries[] | "export \(.key)=\(.value|@sh)"')"
unset compose_inputs_json
pnpm compose:t22 preflight
```

Successful generator output contains only the environment variable names, filesystem paths, image
digests, release SHA, and a count summary. It never contains credential material. Successful
preflight output separately records `releaseGitSha` and `operatorGitSha` with the verified
`ancestor-or-equal` relationship. Compose story evidence uses the release SHA as its `gitSha`; the
operator HEAD remains separate provenance and must never replace the release identity. Story
execution remains a separate operator-authorized step described by `acceptance-contract.json`; the
acceptance runner does not automatically start, stop, clean, or delete the Compose project.

Rootless Compose presents bind-backed configs and secrets as container-root-owned files even when
the source files remain operator-private `0600`. The `config-init` one-shot therefore copies only
the canonical settings, deployment Secret JSON, and callback token into the retained
`runtime-config` volume with `0400` files owned by UID/GID 1000. Web, Worker, migration, realm
bootstrap, and both Runner services mount that handoff read-only and still execute as UID/GID 1000.
Ordinary `down` retains this private volume; include `runtime-config` only in private backup
artifacts, and remove it only through the explicitly confirmed `compose:t22 clean` workflow.
