# T19 Spike — Agent Definition Derivation and Prompt Contract

## Question and constraints

T19 needs a definition format that can derive Coding, Writing, and later specializations from a
base Agent without turning inheritance or Prompt text into authority. The format must preserve an
exact birth version, allow mechanical review, and remain provider-neutral. This spike compares
definition composition and Prompt representation only; it does not select a Provider or implement
production code.

The governing separation remains:

```text
CapabilityDefinition (business intent)
  → AgentDefinition@version (specialization contract)
  → RuntimeProfile (deployment/provider/resources)
```

## Definition composition alternatives

| Alternative | Advantages | Failure modes | Decision |
| --- | --- | --- | --- |
| Standalone immutable definitions only | Smallest parser; no graph or merge semantics | Repeats authority and result-envelope rules; base fixes must be copied; relationship between base and specialization is documentary | Keep for root definitions, but not as the only model |
| One exact parent, flattened at activation | Predictable graph; simple cycle detection; child birth is independent of later parent versions; source and effective definition can both be reviewed | Needs an explicit override vocabulary and two mechanical diffs | **Choose for v1** |
| Multiple parents/mixins | Reuses orthogonal Prompt/policy fragments | Ordering, duplicate block IDs, schema merge, policy widening, diamond provenance, and diff attribution become new product semantics | Reject for v1 |

`extends` always names an exact active version such as `base-agent@1`, never the active pointer
`base-agent`. A definition without `extends` is a root. A child has one parent and an explicit
specialization patch; arbitrary JSON merge-patch is not accepted.

Minimal source wire shape:

```json
{
  "schemaVersion": 1,
  "ref": "coding-agent@1",
  "extends": "base-agent@1",
  "specialize": {
    "replace": {
      "intent": "Implement a bounded software change",
      "contracts": { "inputSchema": {}, "outputSchema": {} },
      "runtimeRequirements": {
        "class": "workspace-agent",
        "features": ["git-worktree", "shell"]
      },
      "policies": {},
      "evaluationPolicy": {}
    },
    "appendPromptBlocks": []
  }
}
```

The replacement allowlist is closed: `intent`, `contracts`, `runtimeRequirements`, `policies`, and
`evaluationPolicy`. Prompt blocks are append-only during derivation and their IDs must be unique
across the lineage. A child cannot replace/delete an inherited block, change its own identity or
version through the patch, replace provenance, or alter activation/approval semantics. Sealed
authority blocks therefore remain intact. Runtime and tool policy may differ between base, Coding,
and Writing definitions, but inheritance is reuse—not authorization: every flattened child must
independently pass runtime/tool/resource/verifier activation checks, and Run grants still use the
four-way intersection in `architecture.md`.

Activation resolves the parent recursively, rejects a missing or non-active exact version, detects a
cycle with a DFS recursion stack, applies the allowlisted patch, validates the complete result, and
persists an immutable artifact:

```json
{
  "schemaVersion": 1,
  "ref": "coding-agent@1",
  "derivedFrom": {
    "ref": "base-agent@1",
    "flattenedHash": "sha256:..."
  },
  "definition": { "intent": "...", "prompt": {}, "contracts": {}, "policies": {} },
  "flattenedHash": "sha256:..."
}
```

A Run stores the exact definition ref, flattened hash, compiled Prompt hash, task/result schema refs,
and Runtime Profile provenance. It never resolves `extends` at execution time. Activating
`base-agent@2` cannot change a Run or child born from `base-agent@1`; changing the child requires a
new child version.

## Prompt representation alternatives

| Alternative | Advantages | Failure modes | Decision |
| --- | --- | --- | --- |
| Typed role/block/binding data | Static source/schema checks; deterministic messages and hash; explicit authority/data boundary | More verbose; requires a compiler | **Choose** |
| Mustache-style free text | Familiar authoring and concise examples | Injection/escaping ambiguity; variables hidden in strings; difficult pointer coverage and mechanical diff | Reject |
| Provider-native templates | Direct access to Provider features | Locks definitions to one Provider; role/tool semantics and hashes drift across adapters | Reject as definition truth |

Literal professional instructions remain free text, but values are never interpolated into that text.
Dynamic values occupy whole typed blocks:

```json
{
  "schemaVersion": 1,
  "blocks": [
    {
      "id": "authority",
      "role": "system",
      "purpose": "authority",
      "literal": "Operate only within effective grants.",
      "sealed": true
    },
    {
      "id": "objective",
      "role": "user",
      "purpose": "task-data",
      "binding": {
        "source": "task",
        "pointer": "/objective",
        "encoding": "json-delimited",
        "required": true
      }
    }
  ]
}
```

Each block has exactly one of `literal` or `binding`. Block order is semantic. IDs are stable diff
anchors. `task` and `context` bindings may only produce data-role blocks and are encoded as JSON in
an unambiguous delimiter envelope; they cannot enter `system` authority blocks. `policy` bindings
may enter a system block but resolve only from the activated, server-owned policy snapshot. They do
not read task fields. Provider adapters may translate the compiled provider-neutral messages, but
provider-native templates are neither stored in Agent Definitions nor hashed as their identity.

Activation parses bindings as RFC 6901 JSON Pointers and proves that every pointer exists in the
corresponding input, context, or policy schema. Unknown sources, unknown pointers, duplicate block
IDs, illegal role/purpose pairs, bad encodings, or task-bound authority fail activation. Schemas may
contain fields unused by a Prompt; “coverage” means every dynamic Prompt value is declared and
typed, not that every task field must be rendered.

## Canonical identity and review

Canonical JSON recursively sorts object keys and preserves array order. Non-JSON values,
non-finite numbers, duplicate semantic IDs, excessive depth/bytes/nodes, and unknown fields are
rejected before hashing. Reuse the repository's canonical JSON semantics; compute persisted
artifact identities as `sha256:<64 lowercase hex>`. The pure kernel may expose canonical bytes and a
non-cryptographic diagnostic fingerprint, while the persistence/runtime composition boundary owns
SHA-256. Hashes cover schema version, exact ref, exact parent ref/hash, and the full flattened
definition; mutable lifecycle status and deployment secrets are not part of the artifact.

Human activation renders two ordered JSON-Pointer diffs:

1. **Authored diff:** previous source → candidate source, showing the requested parent and patch.
2. **Effective diff:** previous flattened artifact → candidate flattened artifact, showing actual
   Prompt, contract, runtime, and policy changes after inheritance.

The approval receipt stores source hash, parent ref/hash, flattened hash, both diff hashes, and Eval
evidence refs. This avoids hiding a parent-induced semantic change while keeping review mechanical;
neither diff is generated or summarized by an LLM.

## Disposable probe

A dependency-free Node probe implemented the source wire, exact-version resolver, allowlisted
replacement, append-only Prompt blocks, schema-pointer validation, canonical SHA-256, and a minimal
effective diff. It exercised ten required outcomes:

| Scenario | Observed result |
| --- | --- |
| Valid one-parent derivation | Flattened three ordered blocks and recorded exact parent hash |
| Parent v2 introduced after child activation | Existing child hash stayed identical |
| Missing exact parent | Rejected before flatten |
| `a@1 → b@1 → a@1` | Rejected with the cycle path |
| Attempt to replace Prompt wholesale | Rejected as forbidden override |
| Attempt to reuse sealed `authority` block ID | Rejected |
| Task binding placed in system role | Rejected |
| Task pointer absent from input schema | Rejected |
| Same objects with different key order | Produced the same SHA-256 |
| Semantic intent change/array order change | Produced a different SHA-256 and pointer diff |

Validation command and output:

```text
$ node /tmp/t19-definition-prompt-probe.mjs
{
  "scenarios": 10,
  "passed": 10,
  "bornHash": "sha256:7877bd358a6efd79380709b5aeb0cec533da007a0da5345e4d42b42b19ca0dae",
  "revisedHash": "sha256:430092176203c1ef54551cd918f05f7d941c41f212ac18f8944e49f6737e7a94",
  "changedPaths": ["/ref", "/definition/intent"]
}
```

Document-scope verification:

```bash
git diff --check -- conductor/tracks/t19-specialized-agent-contracts_20260823/spikes/definition-prompt.md
rg -n 'Choose|Reject|birth|missing|cycle|forbidden|binding|authority|canonical|diff' \
  conductor/tracks/t19-specialized-agent-contracts_20260823/spikes/definition-prompt.md
```

## Decision and risks

Adopt standalone immutable roots plus **at most one exact-version parent**, explicit allowlisted
specialization replacement, append-only unique Prompt blocks, and activation-time flattening. Adopt
provider-neutral typed Prompt blocks with whole-value schema bindings. Persist both authored and
flattened mechanical diffs and content hashes. Do not support floating parents, arbitrary deep
merge, Mustache interpolation, provider-native template truth, or mixins in v1.

Remaining implementation risks are bounded:

- Replacing a whole contract/policy section can produce a large diff; stable sub-object IDs and the
  effective diff make it reviewable without inventing deep-merge semantics.
- JSON Schema pointer validation must handle `$ref` deliberately. V1 should accept only resolvable
  local refs or resolve registered exact schema refs before activation; unresolved/remote refs fail
  closed.
- Provider role support differs. Adapters may coalesce adjacent blocks, but the Run Prompt hash must
  cover the exact provider-neutral compiled messages and the adapter must record the actually sent
  message hash/provenance.
- A useful future mixin case may emerge. Add composition only after two concrete specializations
  demonstrate repetition that cannot be handled by a single parent; do not reserve ambiguous merge
  behavior now.
