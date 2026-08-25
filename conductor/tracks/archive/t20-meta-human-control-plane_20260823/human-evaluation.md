# T20 Human Evaluation Protocol

## Fixed corpus

The authoritative corpus is U1-U22 in `user-stories.md`. Evidence uses the record shape in
`evidence.md`; every record must name principal, requested/effective scope, route, rel, renderer,
entity revision, rendered/executed actions, accessibility, request count, timing and result.

## Golden tasks

1. **Application orientation (30 s):** from `/meta`, find Publishing, state its purpose, identify one
   Flow and one Capability, then open `post-status` in at most two navigation interactions.
2. **Agent permission explanation (60 s):** select Governance, open
   `agent-definition-author@1`, identify sealed authority, task/result contracts, runtime features,
   allowed tools/resources, Eval policy and one prohibited operation.
3. **Draft decision (90 s):** open an invalid Agent Definition Draft from its source Run, locate the
   blocking issue, revise/validate/submit, observe Agent approval denial, and make a human decision
   from diff/check/Eval/source evidence. Provider execution time is excluded.
4. **Future surface:** add the synthetic `meta/widgets` fixture to a sitemap test, discover it with no
   dashboard branch, render it through generic fallback, and prove undeclared execution is rejected.

## Observation record

For each task record elapsed seconds, clicks/page changes, hesitation, misreads, raw-contract use,
keyboard completion, desktop/mobile screenshot paths and findings by severity. A Critical or High
finding fails closure. Raw JSON use for any default task also fails its time-budget acceptance.

## Mechanical gate

The evaluation cannot waive scope leakage, invented facts/actions, hidden-current-action bypass,
Agent/system approval, stale half-activation, internal callback exposure, replay drift, page-level
mobile overflow, or a keyboard-blocked decision. These checks must remain 100% automated.
