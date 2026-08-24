# T22 Compose operator inputs

The Compose production input generator validates operator-owned files; it does not create or print
credentials. Prepare one canonical settings JSON, one canonical deployment Secret JSON, and the
eight independently mounted password files referenced by `compose.yaml`. Every file and the input
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
