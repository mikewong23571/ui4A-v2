# T17 Phase A Probe Record

## Red baseline

- No `ui4a` executable or CLI workspace existed; a third-party Agent had to compose raw URLs and
  request bodies.
- Candidate Application/Flow files had no generic system-owned Draft aggregate, CAS, validation,
  diff, lifecycle or approval reference.
- Existing meta lifecycle edited one Flow through narrow `add-node`/`add-action` operations; it did
  not accept a complete candidate through a governed buffer.
- HTTP identity remained the explicitly documented local-demo self-report boundary (D8/D10).
- Application Bundle bootstrap was atomic only as initial installation planning, not as candidate
  approval/apply.

## Probe conclusions

### CLI

- A disposable TypeScript binary ran from `/tmp` and completed doctor/sitemap/entity/action/audit.
- `tsc` output + package `bin` is required; Node strip-types rejected parameter properties.
- Stable exit classes are usage/config/auth/not-found/judgment/conflict/network/protocol.
- Existing `/api/events` lacked server-side limit, and canonical Bundle data needed one meta resource.

### Storage

- Shared events + `draft` domain matches the existing Presentation precedent.
- A 7.6 KiB Bundle repeated 1,000 times was roughly 41x larger inline than hash-reference events.
- Payloads therefore use immutable SHA-256 content addressing plus rebuildable projection.
- Draft-domain append serialization is required because sequence allocation is not commit ordering.

### Atomic apply

- Existing `definition-activated` requires a prior pending lifecycle/activation chain and cannot
  represent a complete candidate with current narrow edit verbs.
- One complete apply event avoids a second candidate truth and preserves replay/birth versions.
- Agent approval must fail at route/service and pure-fold boundaries; CLI omission alone is not trust.

The production implementation follows D29. Disposable probes were kept outside the repository and
did not become production code.
