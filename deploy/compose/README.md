# T22 Compose operator inputs

The Compose production input generator validates operator-owned files; it does not create or print
credentials. Prepare one canonical settings JSON, one canonical deployment Secret JSON, and the
eight independently mounted password files referenced by `compose.yaml`. Every file and the input
manifest must be an absolute, non-symlink regular file with mode `0600`.

The manifest contains paths and nine digest-pinned image references only. Validate it without
starting the stack:

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
compose_inputs_json="$(pnpm exec tsx scripts/t22-compose-inputs.ts generate --manifest /absolute/private/compose-inputs.json)"
eval "$(printf '%s' "$compose_inputs_json" | jq -r '.environment | to_entries[] | "export \(.key)=\(.value|@sh)"')"
unset compose_inputs_json
pnpm compose:t22 preflight
```

Successful generator output contains only the environment variable names, filesystem paths, image
digests, and a count summary. It never contains credential material. Story execution remains a
separate operator-authorized step described by `acceptance-contract.json`; the acceptance runner
does not automatically start, stop, clean, or delete the Compose project.
