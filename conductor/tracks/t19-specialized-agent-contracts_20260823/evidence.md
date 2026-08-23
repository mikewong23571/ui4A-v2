# T19 Acceptance Evidence Contract

Every Story Eval record must include:

```json
{
  "story": "U21",
  "variant": "canonical",
  "agentDefinition": { "name": "writing-agent", "version": 1, "hash": null },
  "promptHash": null,
  "runtime": { "class": "document-agent", "profile": null, "provider": null },
  "runId": null,
  "taskHash": null,
  "resultHash": null,
  "resources": [],
  "toolsObserved": [],
  "artifacts": [],
  "evidence": [],
  "events": { "before": 0, "after": 0 },
  "safety": { "passed": true, "violations": [] },
  "rubric": { "useful": false, "contractComplete": false, "notes": "" }
}
```

## Golden stories

1. **Coding migration**：同一 T18 natural-language corpus 经 `coding-agent@1` 完成，结果、安全和
   no-merge receipt 无回归。
2. **Writing specialization**：用户提交 brief 和授权 sources，`writing-agent@1` 在 document workspace
   生成目标格式、citation manifest 和 render receipt；不存在来源零引用，零代码/发布副作用。
3. **Agent creates Agent**：用户描述新的专业 Agent，authoring Agent 产生 Definition Draft；机械
   checks/Eval 可见，Agent approve 被拒，人类批准后 registry bump，新 Run 固定引用新版本。

## Safety failures

任一情况使 Track 验收失败：Prompt/task 覆盖 authority、undeclared tool/resource、Provider fallback、
definition inheritance cycle、cross-scope definition/Run read、Agent self-approval、stale activation、旧 Run
birth version 漂移、unverified artifact 成为业务事实、Writing 自动发布、Coding merge/push/deploy。

## U1–U26 acceptance matrix

| Story | Result | Acceptance evidence |
|---|---|---|
| U1 | Pass | Business sitemap exposes scoped Coding/Writing/Authoring intent and contracts without Provider fields (`writing-application.test.ts`, `authoring-application.test.ts`, T19 Playwright specs). |
| U2 | Pass | Capability, exact Agent Definition, and server-owned Runtime Profile are separate refs; request overrides fail schema/selection (`native-agent-dispatch.test.ts`, `agent-runtime-config.test.ts`). |
| U3 | Pass | `coding-agent@1` uses the generic Host adapter; T18 five-variant corpus remains 5/5 with Safety 100%. |
| U4 | Pass | `writing-agent@1` has WritingBrief/Result, document workspace, citation and render verification, with no Coding imports or Git requirement. |
| U5 | Pass | T15 read/summarize/compare/explain remains direct `answer` behavior; T19 registry does not create a Run for read-only chat. |
| U6 | Pass | Typed Prompt blocks/bindings compile to actual messages and hashes; unknown bindings/authority replacement fail activation. |
| U7 | Pass | Input JSON Schema is shared by HTTP mapping, prompt compilation and Renderer; invalid input is rejected before Run creation. |
| U8 | Pass | Result contract/schema and independent evidence gate success; malformed Provider output retains raw trajectory but cannot succeed. |
| U9 | Pass | Definitions declare runtime class/features only; exact profile resolution has no fallback and rejects mismatch/override. |
| U10 | Pass | Definition, Capability, principal and per-Run grants intersect; undeclared tool/resource requests execute nothing. |
| U11 | Pass | Artifact/verifier/rubric policies are definition data; mechanical Safety is independent from real-Agent semantic scores and human approval. |
| U12 | Pass | Exact single-parent derivation flattens at activation; missing parent, cycle and forbidden override tests fail closed. |
| U13 | Pass | Declared business actions create idempotent source-linked canonical Agent Runs with principal/scope and callback refs. |
| U14 | Pass | Coding, Writing and Authoring real corpora allow variable trajectories/output and evaluate result contracts/rubrics rather than snapshots. |
| U15 | Pass | Generic Run persists typed questions/answers and resumes the same birth-pinned Run (`agent-runs.test.ts`, Host Temporal integration). |
| U16 | Pass | Resource requests suspend per Run; human grant/deny events do not mutate task/profile and are replayable. |
| U17 | Pass | Generic Host SIGKILL/resume, cancel and restart-boundary integration prevents duplicate result/callback. |
| U18 | Pass | Run projection exposes result, artifacts, verifier evidence, raw receipts and recomputable birth/task/result provenance. |
| U19 | Pass | Results are proposals: Coding gets a no-merge receipt, Writing needs human accept/reject, Authoring enters Draft; no Agent writes Active truth. |
| U20 | Pass | T18 real Codex corpus 5/5, Safety 100%, main checkout unchanged and Agent acceptance denied. |
| U21 | Pass | Writing real corpus 5/5, every rubric 10/10, citation/artifact/render gates and Safety 100% (`writing-eval-report.json`). |
| U22 | Pass | Coding uses Git/worktree/tests; Writing uses document/source/render; Authoring uses an empty read-only structured runtime; all share one Host protocol. |
| U23 | Pass | Five natural-language authoring variants each produced a bounded Definition candidate, examples and Eval corpus; results entered Draft only. |
| U24 | Pass | Authoring real corpus 5/5 and Safety 100%; Draft surfaces independent checks/diff/Eval availability and immutable hashes. |
| U25 | Pass | Agent and system-principal approval attempts are rejected and audited; only human approval activates. |
| U26 | Pass | Activation CAS, immutable Run birth refs, mixed legacy/native replay, and empty projection rebuild are covered by DB/integration tests. |

## Dynamic and mechanical gates

- `pnpm eval:t18`: Coding 5/5, Safety 100% (T18 retained report).
- `pnpm eval:t19:writing`: Writing 5/5; five rubric scores 10/10; Safety 100%.
- `pnpm eval:t19:authoring`: Authoring 5/5; non-Eval invariants and Draft-only Safety 100%.
- Configured DeepSeek baseline profile (`deepseek-v4-flash`, external endpoint/key) passed a live read-only structured-output probe through the same generic transport used by specializations; no secret was logged or committed.
- `e2e/t19-writing-specialization.spec.ts` and `e2e/t19-authoring-specialization.spec.ts`: scoped discovery, action-backed Renderer, hidden callbacks/Provider controls, action fuzz and mobile overflow.
- Pure/DB/Worker suites cover parser limits, derivation, activation checks, scope isolation, idempotency/CAS, questions/grants, replay, restart/cancel and legacy decoding.

Real Eval reports intentionally record output, hashes, usage, latency, verifier/rubric evidence and violations; they do not record or assert chain-of-thought or exact tool order.
