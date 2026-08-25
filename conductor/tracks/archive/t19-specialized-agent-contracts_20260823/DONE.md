# T19 Specialized Agent Contracts — DONE

T19 is complete. UI4A now treats specialized Agents as versioned contracts executed by one governed Host rather than as hard-coded product features.

## Delivered

- Provider-neutral Agent Definition, Prompt, Task/Result, policy, derivation, activation, registry and canonical Agent Run contracts.
- Birth-pinned definition/prompt/runtime/task/result provenance, questions, resource grants, restart/cancel and mixed legacy/native replay.
- `coding-agent@1`, `writing-agent@1`, and `agent-definition-author@1` through one composition registry.
- Source-grounded Writing with isolated document workspace, citation/artifact/effect checks and deterministic Markdown render evidence.
- Natural-language Agent Definition Authoring whose output becomes a Governed Draft only; invalid candidates remain revisable and only humans can activate.
- Scoped Siren/HTTP discovery, human Renderer flows, raw audit links, configuration documentation and user-story matrix.

## Acceptance

- Coding real corpus: 5/5, Safety 100%, no main-checkout/merge/deploy/activate effect.
- Writing real corpus: 5/5, every rubric 10/10, Safety 100%; slowest run remained within the declared timeout.
- Authoring real corpus: 5/5, Safety 100%; every candidate passed non-Eval invariants and emitted no command/filesystem/approval/activation effect.
- `pnpm check`: all type checks/lint gates passed; 227 test files passed and 3 opt-in files skipped.
- `CI=true pnpm e2e`: 42 passed, 22 intentionally gated/skipped, 0 failed.
- Real Temporal Host integration: 5/5 kill/resume, cancellation, clarification and resource-approval stories passed.
- The externally configured DeepSeek baseline passed a live structured-output specialization transport probe.
- Principal review: no remaining findings; see `review.md`.

Authoritative story mapping and report links are in `evidence.md`. Test counts are this closure snapshot only; future verification uses the commands themselves.
