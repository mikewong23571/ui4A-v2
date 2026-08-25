# User Sidecar Storage and Projection Probe

## Outcome

Use the existing PostgreSQL `events` table as the only durable truth, but fold Presentation events
into a separate `PresentationSnapshot`. Serve the fastpath from a rebuildable
`presentation_user_sidecars` projection with a principal-first B-tree lookup. Do not put Sidecars
inside `EngineSnapshot`, do not replay the global log on each request, and do not create a second
authoritative Sidecar store.

The durable key is user-level:

```text
(principal, policyScope, subject, intent, deviceClass)
```

It never contains `sessionId`, `turnId`, route, delivery target, or Canvas identity. Chat Session A,
Chat Session B, Canvas, and direct navigation therefore resolve the same Sidecar id/version. A
Session may persist only a receipt/pointer to that result.

This was a disposable read-only probe. It added no production type, migration, dependency, or
runtime behavior.

## Current storage and replay evidence

- `events` is already a general append-only envelope with global `BIGSERIAL seq`, timestamp,
  principal, channel, kind, rel, and JSONB detail. Its trigger rejects update/delete
  (`apps/web/src/db/events.sql:5-32`).
- `appendEvent` accepts either a pool or transaction client, but currently appends one row without
  an idempotency key. `listEvents` can only page by global sequence
  (`apps/web/src/db/events.ts:98-104,162-208`).
- The live engine boots by reading the complete log and incrementally folds later global-sequence
  gaps (`apps/web/src/engine/service.ts:257-265,388-397,495-519`). This ordering model can be reused
  by an independent Presentation projector.
- `EngineSnapshot` currently includes business, definition, capability and old frozen RenderSpec
  state, but no Presentation aggregate (`packages/shared/src/state.ts:152-209`). A User Sidecar must
  not be added to this shape.
- Business `fold` intentionally throws on an unknown event kind
  (`packages/engine/src/fold.ts:805-890`). This fail-closed behavior should remain: the storage
  adapter must give the Business and Presentation folds their own domain slices rather than make the
  Business fold silently understand every Presentation event.
- Existing PostgreSQL replay tests compare online and replayed snapshots using `contentVersion`
  (`apps/web/src/db/replay.test.ts:258-269`). `contentVersion` is canonical JSON plus a truncated
  48-bit FNV hash and is appropriate for assertions/cache hints, not as the sole authorization or
  principal-isolation key (`packages/engine/src/sitemap.ts:199-229`).

Read-only inspection on 2026-08-23 found 42 current events, 160 kB total table size, and only the
primary/ascending `seq` indexes. A prospective principal/kind Sidecar query therefore used a
sequential scan. That is harmless at 42 rows but is not a fastpath design.

## Options compared

| Design | Replay | Invalidation and concurrency | Lookup/performance | Decision |
| --- | --- | --- | --- | --- |
| Fold Presentation events from the global log on every request | Exact and simplest | Can enforce versions in memory, but every process rebuilds and races on append | O(all events) per cold process/request; no principal lookup index today | Reject as serving path; retain as correctness oracle |
| Put current Sidecar JSON in an independent durable table | Fast | Easy row locking, but history and current state can diverge or be partially written | O(log n) | Reject as a second truth |
| Existing log + independent pure fold + rebuildable current projection | Exact full replay; projection can be dropped and rebuilt | Append and projection CAS can share one PG transaction; stale state and active pointer are explicit | O(log n), one row supplies active Surface and dependency manifest | **Choose** |
| Process-local Map only | Rebuilt from log | No safe cross-process CAS; lost on restart | Fast after full replay | Use only as an optional read-through cache above the DB projection |

The projection is not business truth. Deleting it loses performance only: rebuilding all
Presentation events must reproduce the same rows, active versions, retention, stale reasons, and
dependency hashes.

## Exact aggregate and event shapes

Presentation events should use `channel='presentation'`, `rel='user-sidecar:<id>'`, and a versioned
detail envelope. `eventId` makes an individual append idempotent; `commandId` makes a retried user or
Broker command return its prior result. Neither identifier is a Session id.

```ts
interface PresentationEventEnvelope<T> {
  schemaVersion: 1;
  eventId: string;
  commandId: string;
  aggregate: { type: 'user-sidecar'; id: string };
  detail: T;
}

interface UserSidecarKey {
  principal: string;
  policyScope: string;
  subject: RenderSubject;
  intent: string;
  deviceClass: 'any' | 'compact' | 'wide';
}

interface SidecarVersionState {
  version: number;
  basedOnVersion: number | null;
  recipeRef?: { id: string; version: number };
  surface: NormalizedSurfaceTree;       // bindings only; no hydrated values
  dependencies: RenderDependency[];
  retention: 'cache' | 'pinned';
  provenance: PresentationProvenance;
  surfaceFingerprint: string;
  dependencyFingerprint: string;
}

interface UserSidecarAggregate {
  id: string;
  key: UserSidecarKey;
  versions: Record<number, SidecarVersionState>;
  maxVersion: number;
  activeVersion: number;
  stale?: { reasons: StaleReason[]; detectedAtSeq: number };
}

interface PresentationSnapshot {
  sidecarsById: Record<string, UserSidecarAggregate>;
  activeSidecarsByKey: Record<string, string[]>; // pinned/cache candidates, owner-checked
  requestsById: Record<string, PresentationRequestState>;
  recipesById: Record<string, ApplicationRenderRecipeAggregate>;
  lastPresentationSeq: number;
}
```

Required lifecycle payloads:

| Kind | Required detail | Fold effect |
| --- | --- | --- |
| `user-sidecar-instantiated` | full key, `version=1`, Surface, dependencies, retention, provenance | Create aggregate and active key pointer; duplicate `commandId` is idempotent |
| `user-sidecar-revised` | `baseVersion`, new monotonically increasing version, normalized patch, resulting Surface/dependencies/fingerprints | Add immutable version and move active pointer after CAS |
| `user-sidecar-pinned` | `baseVersion`, new version with retention `pinned`, provenance | Preserve prior cache version and move active pointer |
| `user-sidecar-staled` | observed active version, changed dependency ids, reason codes, current fingerprints | Mark unusable; never delete history |
| `user-sidecar-reverted` | observed active version and `targetVersion` | Move active pointer only; `maxVersion` remains monotonic |
| `user-sidecar-evicted` | observed cache version and policy reason | Remove only the rebuildable cache pointer; history remains |
| `render-feedback-recorded` | Sidecar/version, rating/reason, source interaction | Audit only; does not change active content |

`presentation-requested/resolved/failed` and Recipe/promotion events share the Presentation domain but
fold into their own request/Recipe tables inside `PresentationSnapshot`; they must not masquerade as
User Sidecar versions.

## Key, fingerprint, and dependency rules

Canonicalize JSON object keys while preserving array order. Root order is meaningful for a
comparison/selection. Normalize absent `deviceClass` to `any`; never store SQL `NULL` in a unique-key
column. Store the raw canonical key as well as a `sha256:` fingerprint:

```text
keyFingerprint = sha256(canonicalJson({
  schemaVersion: 1,
  principal,
  policyScope,
  subject,
  intent,
  deviceClass
}))
```

Authorization lookup must compare the raw principal/policy/key tuple after using the fingerprint as
an index hint. A truncated `contentVersion` must not be the only boundary between principals. The
key intentionally excludes retention: pinning changes a version, not the viewing situation. If old
cache and pinned aggregates coexist during migration, pinned wins and the duplicate is diagnosed.

Dependencies separate values from contracts so ordinary data changes do not destroy layout memory:

```ts
interface RenderDependency {
  id: string;
  subtreeId: string;
  kind: 'entity-contract' | 'collection-membership' | 'definition' | 'catalog' | 'policy';
  ref: string;
  pointers: string[];
  mode: 'rehydrate' | 'invalidate';
  optional: boolean;
  fingerprint: string;
}
```

- Entity contract fingerprints cover authorized class/semantic roles, property schema/content type,
  relation declarations, and action name/method/field schema/risk/guard/effect. They exclude field
  values, current guard results, `enabled`, form data, and hydrated action state.
- Collection membership is `rehydrate`; an incompatible member contract invalidates only the item
  subtree/Recipe.
- A Flow child uses its resolved birth-definition/node/action pointers. A node transition stales the
  Current Task child, not the stable shell.
- Catalog fingerprints combine catalog version and the schemas of words actually used by a subtree.
- Policy fingerprints cover the effective policy version as well as `policyScope`. Lookup always
  reauthorizes even when the fingerprint matches.
- `dependencyFingerprint` is the canonical hash of sorted dependency records. Per-dependency hashes
  remain available so invalidation can report exact reused/replanned subtree ids.

## Rebuildable projection and indexes

One derived row should contain everything needed to validate and return the active version without
replaying history:

```sql
CREATE TABLE presentation_user_sidecars (
  sidecar_id             TEXT PRIMARY KEY,
  principal              TEXT NOT NULL,
  policy_scope           TEXT NOT NULL,
  subject                JSONB NOT NULL,
  subject_fingerprint    TEXT NOT NULL,
  intent                 TEXT NOT NULL,
  device_class           TEXT NOT NULL,
  retention              TEXT NOT NULL,
  active_version         INTEGER NOT NULL,
  max_version            INTEGER NOT NULL,
  status                 TEXT NOT NULL,
  surface                JSONB NOT NULL,
  dependencies           JSONB NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  provenance             JSONB NOT NULL,
  updated_seq            BIGINT NOT NULL
);

CREATE UNIQUE INDEX presentation_user_sidecars_lookup
  ON presentation_user_sidecars
     (principal, policy_scope, subject_fingerprint, intent, device_class, retention);
CREATE INDEX presentation_user_sidecars_dependencies
  ON presentation_user_sidecars USING GIN (dependencies jsonb_path_ops);
```

The resolver queries exact `principal` and `policy_scope`, compares raw `subject`, discards `stale`,
orders `pinned` before `cache`, then performs live authorization and dependency validation. No query
accepts a caller-supplied Sidecar id without checking owner/key.

A separate one-row projection checkpoint (`name='presentation', last_seq`) permits incremental catch
up. Update the checkpoint and affected projection rows in one transaction. It is disposable: startup
can truncate/replay if the checkpoint is missing, ahead of the event log, or fails a fold hash check.

For clean storage-domain isolation, add an event domain discriminator during implementation (for
example `domain='core' | 'presentation'`, defaulting existing rows to `core`) plus
`(domain, seq)`. Add a Presentation-only unique index for `eventId` and a User-Sidecar-mutation
unique index for `commandId`; request/resolution event pairs may share a command and therefore do not
use the latter index. Until that migration exists,
explicit Presentation-kind filtering is required; broad `kind LIKE` rules are insufficient as the
families include `render-recipe-*` and `user-sidecar-*`.

## Write, retry, and race protocol

Each mutate command runs in one PostgreSQL transaction:

1. Check the Presentation event idempotency index for `commandId`; return the prior receipt on hit.
2. Lock the current projection row `FOR UPDATE`. For first instantiation, serialize the exact
   user-level key with a transaction advisory lock or resolve the unique-index conflict and retry.
3. Require `baseVersion === activeVersion`. A stale base may auto-rebase only when normalized patch
   paths are disjoint from every intervening version; otherwise reject with a structured conflict.
4. Append exactly one version event and update the derived projection/checkpoint in the same
   transaction. The event remains truth; projection corruption is repaired by replay.
5. Return a receipt carrying `sidecarId`, `activeVersion`, dependency validation result and Business
   event high-water mark.

The resolver must validate again immediately before hydration. A stale event racing after the read
cannot authorize interaction: the Surface Action Adapter re-reads the live Entity action/guard/schema
and rejects a Sidecar version/status mismatch before `/api/exec`. Child replan writes a complete new
child version first, then atomically changes the parent's child pointer; mixed versions are never
served.

Cache eviction is also an event/policy operation, not `DELETE` from the event log. Removing an
evictable projection row is allowed because replay can reconstruct it; pinned rows are retained in
the projection unless explicitly reverted/staled.

## Executed, read-only probes

Cross-entry lookup was executed as a read-only PostgreSQL CTE whose request rows differed only by
entry and Session. All four resolved `usc_01@2`:

```text
canvas / no session  -> usc_01@2
chat / session-A     -> usc_01@2
chat / session-B     -> usc_01@2
direct / no session  -> usc_01@2
```

The join columns were exactly `principal, policy_scope, subject_key, intent, device_class`; Session
was output-only. This is the executable acceptance shape for S18.

Business hash isolation was probed against the current 42-row development log by adding an in-memory
`presentation-requested` event. Unfiltered Business fold failed closed as expected; routing that
event only to the Presentation domain left the Business hash byte-for-byte equal:

```json
{
  "businessHash": "cc4730a7a747",
  "isolatedHash": "cc4730a7a747",
  "same": true,
  "unfilteredFailure": "unknown presentation-requested event"
}
```

The hash value is development-state-specific; equality and fail-closed routing are the invariant.

A read-only synthetic probe compared replay scanning with a current-state index over 1,000,000
events and 100,000 user keys on this machine:

```text
build current projection: 268.01 ms
100 reverse log scans:     123.53 ms
100,000 Map lookups:         0.83 ms
same Sidecar/version:        true
```

This is directional, not a production benchmark. Phase G must measure the real PostgreSQL indexed
query plus authorization, dependency validation, entity dereference and first Surface render against
the <=500 ms story target. It does show why the log fold belongs off the request fastpath.

Commands used:

```sh
docker exec ui4a-postgres psql -U ui4a -d ui4a -X -P pager=off \
  -c "BEGIN READ ONLY; SELECT count(*), pg_total_relation_size('public.events')
      FROM public.events; SELECT indexname,indexdef FROM pg_indexes
      WHERE tablename='events'; COMMIT;"

docker exec ui4a-postgres psql -U ui4a -d ui4a -X -P pager=off \
  -c "BEGIN READ ONLY;
      WITH user_sidecar_index(principal,policy_scope,subject_key,intent,device_class,
                              sidecar_id,active_version,retention,stale) AS
        (VALUES ('user:mike','author:v3','entity:post:first-post','inspect','desktop',
                 'usc_01',2,'cache',false)),
      requests(entry,session_id,principal,policy_scope,subject_key,intent,device_class) AS
        (VALUES ('chat','session-A','user:mike','author:v3','entity:post:first-post',
                 'inspect','desktop'),
                ('chat','session-B','user:mike','author:v3','entity:post:first-post',
                 'inspect','desktop'),
                ('canvas',NULL,'user:mike','author:v3','entity:post:first-post',
                 'inspect','desktop'),
                ('direct',NULL,'user:mike','author:v3','entity:post:first-post',
                 'inspect','desktop'))
      SELECT r.entry,coalesce(r.session_id,'(none)'),s.sidecar_id,s.active_version
      FROM requests r JOIN user_sidecar_index s
        USING (principal,policy_scope,subject_key,intent,device_class)
      WHERE NOT s.stale ORDER BY r.entry,r.session_id NULLS LAST;
      COMMIT;"

pnpm exec tsx -e "import {contentVersion,fold} from '@ui4a/engine';
  import {readLog} from './apps/web/src/db/events.ts';
  import {closeAllPools,getPool} from './apps/web/src/db/pool.ts';
  void (async()=>{const db=getPool('postgres://ui4a:ui4a@localhost:5433/ui4a');
  const base=await readLog(db); const before=fold(base,{flows:{}});
  const extra={seq:(base.at(-1)?.seq??0)+1,kind:'presentation-requested'};
  let failure=''; try{fold([...base,extra] as any,{flows:{}})}
  catch(error){failure=String(error)}
  const routed=fold([...base,extra].filter(e=>e.kind!=='presentation-requested') as any,
                    {flows:{}});
  console.log({businessHash:contentVersion(before),isolatedHash:contentVersion(routed),
               same:contentVersion(before)===contentVersion(routed),failure});
  await closeAllPools()})()"
```

The synthetic performance probe is reproducible with a plain Node script that creates versioned
objects in memory, builds a `Map` keyed by the five durable key fields, and compares reverse-array
scan with `Map.get`; it performs no file, database, or network write.

```sh
node <<'NODE'
const { performance } = require('node:perf_hooks');
const events = [];
for (let version = 1; version <= 10; version++)
  for (let principal = 0; principal < 1000; principal++)
    for (let subject = 0; subject < 100; subject++)
      events.push({ principal: `user:${principal}`, policyScope: 'author:v3',
        subject: `entity:post:${subject}`, intent: 'inspect', deviceClass: 'desktop',
        sidecarId: `usc:${principal}:${subject}`, version });
const key = (x) => [x.principal,x.policyScope,x.subject,x.intent,x.deviceClass].join('\u001f');
let started = performance.now();
const index = new Map(events.map((event) => [key(event), event]));
const buildMs = performance.now() - started;
const wanted = key({ principal:'user:777', policyScope:'author:v3',
  subject:'entity:post:42', intent:'inspect', deviceClass:'desktop' });
started = performance.now();
for (let repeat=0; repeat<100; repeat++)
  for (let cursor=events.length-1; cursor>=0; cursor--)
    if (key(events[cursor]) === wanted) break;
const scan100Ms = performance.now() - started;
started = performance.now();
for (let repeat=0; repeat<100000; repeat++) index.get(wanted);
console.log({ events:events.length, projectionRows:index.size, buildMs,
  scan100Ms, index100kMs:performance.now()-started });
NODE
```

## Smallest module boundary

Do not create a new workspace package in T16. The smallest acyclic boundary is:

```text
packages/shared/src/presentation.ts
  serializable keys/events/snapshots/dependencies/receipts only

packages/engine/src/presentation/
  pure fold, canonicalization, validator, patch/CAS decision, dependency diff/invalidation
  (separate exports and snapshot; never imported by the Business fold)

apps/web/src/db/presentation.ts
  event-domain reads/appends, transaction/CAS adapter, projection DDL/rebuild/index queries

apps/web/src/engine/presentation/
  Broker, authorization, live fingerprint collection, resolver and receipt orchestration

apps/web/src/render/
  deterministic hydration and A2UI host only
```

`packages/agent` already depends on `@ui4a/engine`, so the Presentation Agent adapter can consume the
pure validator without a dependency reversal. A dedicated `packages/presentation` would add package
and release surface without resolving a current cycle. Extract later only if the kernel needs an
independent non-engine consumer or engine package governance cannot keep the two snapshots separate.

The old `renderSpecs` field is not a migration target: it is concern-keyed, single-component and
folded into `EngineSnapshot`. Reusing it would violate both the separate Presentation Snapshot and
user-level version/concurrency model.

## Phase G acceptance tests implied by the probe

1. Full Presentation replay equals incremental fold/projection for all event orderings allowed by
   aggregate versions; drop/rebuild produces identical canonical state.
2. Injecting every Presentation event family leaves Business Snapshot hash unchanged; accidentally
   passing one to Business fold fails loudly.
3. Source scan proves `sessionId` absent from shared Sidecar types, event payload schema, projection
   columns/indexes and lookup query.
4. Session A, Session B, Canvas and direct navigation under the same principal/key return the same
   Sidecar id/version; a second principal and changed policy scope return no hit.
5. Duplicate `eventId`/`commandId` is idempotent. Concurrent equal `baseVersion` writes produce one
   accepted successor; disjoint patches rebase deterministically, conflicts reject.
6. Field values and collection membership rehydrate without outer-layout invalidation; incompatible
   entity/action/schema/catalog/definition/policy fingerprints stale exactly the dependent subtree.
7. Projection deletion and replay recover pinned/cache retention, every immutable version, active
   pointer, stale reasons and provenance.
8. Real indexed fastpath including reauthorization and dereference returns the first usable Surface
   in <=500 ms with zero Chat/Presentation LLM calls.
