# T22 Disposable Runtime Backend Probe

## Outcome

One server-resolved envelope can drive both a one-shot execution and a trusted host daemon while
producing the same canonical result. The target Kubernetes cluster can create, observe, complete,
cancel, and clean a Job in a dedicated namespace.

The implementation direction is therefore:

- add `apps/agent-runner` as a deployable workspace application;
- support `oneshot` for one isolated Kubernetes Run;
- support `daemon` for a registered trusted host;
- keep backend/profile/image/workspace/resources/network policy server-owned;
- preserve the existing canonical Agent Run and specialization verifiers above the backend.

## Envelope boundary

User-controlled task input contains the task kind/payload and immutable birth references. It cannot
contain:

```text
backend image cwd provider model env
```

After authorization and definition/profile resolution, the server seals:

```text
backend profile image workspace resources networkPolicy
```

The disposable probe injected each forbidden field and required rejection. Canonical result hashing
excluded backend-specific transport details, so one-shot, daemon, and Kubernetes adapters produced
the same result identity.

## Host probe

The probe used a localhost-only HTTP daemon with a runtime-random credential.

Verified:

- one-shot execution;
- daemon delivery;
- authenticated transport;
- duplicate delivery returned the identical result;
- closed transport produced an explicit disconnect;
- cancellation and timeout boundaries completed;
- no credential was written to the report.

This is a protocol probe, not the production Host Runner. Production still needs heartbeats, durable
leases, workspace roots, process supervision, structured logs, callback authentication, and Temporal
integration.

## Kubernetes Job probe

The live probe created `ui4a-runtime-probe`, explicitly disabled Istio injection, and used the
already-cached `docker.io/flannel/flannel:v0.26.1` image only as a disposable shell carrier.
That image is not a UI4A Runtime candidate.

Verified:

1. Job creation and scheduling.
2. Completion condition watch.
3. Canonical JSON result in Pod logs.
4. Long-running Job cancellation.
5. Dependent Pod deletion.
6. Namespace deletion and absence after cleanup.

The first cleanup check observed the normal asynchronous Pod terminating window after Job deletion.
The final probe explicitly waited for Pod deletion before removing the namespace. No probe namespace
or workload remains.

## Lifecycle interpretation

- Job deletion is only a transport cancellation signal; UI4A must still record cancellation intent,
  observed child termination, and the resulting canonical Run transition.
- Duplicate Job/daemon delivery must reuse command/run idempotency and never finalize twice.
- A Runner disconnect leaves a retryable lease boundary; it must not silently switch backend.
- A restart boundary belongs to Agent Run evidence, not Business state.
- Coding workspaces survive successful execution until the human result decision.

## Kubernetes design consequence

The production Worker should create Jobs through a narrow Kubernetes adapter in an activity, never
from deterministic workflow code. The Job should run the same `apps/agent-runner` one-shot artifact
used by the Host daemon and receive only a sealed server-owned envelope.

Required production controls remain:

- dedicated ServiceAccount and namespace;
- fixed digest image;
- resource requests/limits and active deadline;
- explicit workspace/PV binding;
- NetworkPolicy and Istio policy;
- owner/run labels and bounded log/result collection;
- cancellation/TTL/retention without deleting review-pending workspaces.

## Evidence

The executable host/envelope probe is
[scripts/t22-runtime-probe.ts](../../../scripts/t22-runtime-probe.ts). Machine-readable results are
in [runtime-probe.json](./runtime-probe.json).
