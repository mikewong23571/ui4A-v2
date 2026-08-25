# Writing Runtime Spike

## Question and result

Can a real Agent complete a source-grounded Writing Brief through a document workspace while
returning a mechanically verifiable result, without reusing Git/code semantics?

**Result: yes.** Authenticated `codex-cli 0.149.0` produced a 430-word Markdown document and a
schema-constrained citation manifest in a disposable non-Git workspace. Independent checks passed
for result shape, artifact/source hashes, citation coverage, selected claim grounding, Markdown
rendering, changed paths, and absence of Git/network/publish commands. No fallback was used.

## Disposable fixture

The harness created `/tmp/ui4a-t19-writing-CZx8Bo`; the UI4A repository was not the Agent
workspace. Inputs were:

- `brief.json`: engineering-lead audience, 350–500 words, Markdown, four required sections, and a
  requirement that every factual paragraph end with `[S1]`, `[S2]`, or `[S3]`;
- `sources/s1.md`: event-log truth, Temporal recovery, definition/prompt birth refs;
- `sources/s2.md`: proposal governance, independent verification, human approval, grant
  intersection;
- `sources/s3.md`: Capability/AgentDefinition/RuntimeProfile separation and specialization;
- `result-schema.json`: `status`, `summary`, one Markdown artifact with SHA-256, citation entries
  with source hashes and supported claims, plus explicit safety claims;
- an empty writable `out/` directory.

The instruction permitted reads only from those inputs, writes only to `out/briefing.md`, and
forbade source/code/Git/dependency/network/publish effects. The initial probe honestly failed with
HTTP 400 because a response-schema `const` lacked an explicit `type`; adding `type` made the same
schema acceptable. This constraint belongs in Prompt/Result contract validation.

## Real Provider command

```bash
WORK="$(mktemp -d /tmp/ui4a-t19-writing-XXXXXX)"
# Harness writes brief.json, sources/*.md, result-schema.json, prompt.md, and creates out/.
codex login status
codex exec \
  --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check \
  --sandbox workspace-write --cd "$WORK" \
  -c 'web_search="disabled"' \
  -c 'sandbox_workspace_write.network_access=false' \
  --output-schema "$WORK/result-schema.json" \
  --json --output-last-message "$WORK/final.json" \
  - < "$WORK/prompt.md" > "$WORK/raw.jsonl" 2> "$WORK/stderr.log"
```

The successful run took approximately 45 seconds. It reported 64,346 input tokens (45,312
cached), 1,442 output tokens, and 86 reasoning-output tokens. The deployment-selected model was
not overridden by the task.

## Observed protocol and result

The JSONL stream was provider-general enough for a shared Host:

```text
thread.started → turn.started
→ command_execution started/completed
→ file_change started/completed
→ command_execution started/completed
→ agent_message(structured JSON)
→ turn.completed(usage)
```

The Agent read the brief/schema/sources, added only `out/briefing.md`, then ran `wc`, `shasum`, and
`sed`. The final JSON contained `status=completed`, the artifact path/media type/hash, three source
records with hashes and supported claims, and four negative-effect claims. Provider claims were
not treated as verification evidence.

## Independent verification

The verifier used the repository's existing Ajv 8 dependency and system Pandoc; it installed
nothing and wrote the rendered file to a separate `/tmp` directory.

```bash
# Ajv validates final.json against result-schema.json; a verifier then recomputes hashes,
# checks citation markers/known source ids/allowed changed paths, and inspects raw commands.
(cd packages/engine && node --input-type=module /tmp/<inline-verifier>)
pandoc --from=gfm --to=html5 --standalone \
  "$WORK/out/briefing.md" -o /tmp/ui4a-t19-writing-render/briefing.html
```

Observed evidence:

| Check | Result |
| --- | --- |
| Output schema | valid |
| Document SHA-256 | `527ef55a…792eb4b5`, recomputed match |
| S1/S2/S3 hashes | all recomputed matches |
| Factual paragraphs | 8/8 carry known source markers |
| Grounding anchors | 6/6 expected claim-to-source mappings pass |
| Agent file changes | one unique path: `out/briefing.md` |
| Completed commands | two; no Git/curl/wget/package/publish/deploy command |
| Markdown render | Pandoc success, 7,435-byte HTML, five headings, ten source markers |
| Git/code/publish effects | zero observed |

The run proves detection and rejection evidence, not filesystem immutability: a plain
`workspace-write` sandbox does not itself express “sources read-only, out writable.” Production
must enforce that split in the document workspace backend and still compare seed hashes after the
run.

## Runtime comparison and recommendation

Do **not** create a Writing-specific Provider transport. Reuse one generic Agent Host and the same
Codex streamed/structured transport: its thread, event, usage, cancellation, and result mechanics
are not coding-specific. Extract the T18 transport from `CodingTaskClaim`; select specialization
through `AgentDefinition`, not a Host keyword branch.

Do create a distinct `document-workspace` resource backend beside `git-worktree`. It should stage
bounded source refs read-only, expose only a writable artifact root, validate relative output
paths, snapshot input/output manifests, and destroy the workspace after durable artifact capture.
The specialization supplies its contract and verifier set:

- runtime features: `structured-result`, `streamed-events`, `cancel`, `resume`,
  `document-workspace`, `artifact-write`; network is absent unless separately granted;
- Agent tools/grants: source read, artifact write, and bounded hash/word-count operations (the
  spike's general shell access should be narrowed, not made a Writing requirement);
- verifiers: JSON Schema, artifact hash/media/path, immutable-source manifest, citation
  source/hash/paragraph coverage and grounding, deterministic Markdown render, and forbidden
  side-effect inspection.

Therefore Writing and Coding share lifecycle, transport, raw-event capture, budgets, recovery,
and proposal governance, while their workspace backends, Task/Result contracts, tools, artifacts,
and verifiers remain genuinely specialized.
