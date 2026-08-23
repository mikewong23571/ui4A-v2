# T20 Phase A Baseline and Spikes

## Red Baseline

Verified on 2026-08-23 against the running local stack:

- `/_meta/.well-known/ui4a.json` returns seven top-level surfaces: self, flows,
  activations, applications, capabilities, drafts, and agent-definitions.
- `/meta` renders a hard-coded four-item `FACES` list. Applications, Drafts, and Agent
  Definitions therefore have no human route despite existing HTTP contracts.
- The existing browser client cannot fetch the sitemap, carry scope in URL state, cache by
  revision, or route unknown legal Meta entities.
- `policyScope` is currently accepted from a query/header without an allowed-scope check. This
  is consistent with the documented self-reported local identity model, but is insufficient for
  a control-plane selector and must not be described as production authentication.
- `meta/applications` embeds complete Bundles per row, creating avoidable payload and rendering
  cost even though the list needs summaries only.

Reproduction:

```bash
curl -sS http://localhost:3100/_meta/.well-known/ui4a.json
curl -sS http://localhost:3100/meta
curl -sS 'http://localhost:3100/_meta/api/entity?rel=meta%2Fapplications'
```

## Spike Decisions

### Scope and identity

Use a server-owned local-demo authorization adapter. `scope` in the URL is a request only;
the API accepts it only when present in the adapter's allowed scopes, returns the effective scope,
and rechecks the same rule for sitemap, exact/list reads, and exec. The browser sends no principal,
actor, or authorization header. Existing protocol clients may send self-reported headers, but the
same allowlist applies and the UI labels this deployment model honestly.

### Route and renderer

Use `/meta/entity?rel=<encoded>&scope=<scope>` as the canonical human deep link. Friendly legacy
pages remain aliases. A pure class/shape registry selects a specialized renderer; equal-priority
matches fail closed. Unknown legal collection/detail entities use a generic deterministic fallback.
The dashboard consumes sitemap descriptors and contains no product rel inventory.

### Performance

Measure browser resource requests from navigation start until the primary entity is ready. The
dashboard may request sitemap plus bounded summaries. A collection must use embedded summaries;
it may not issue one exact request per member. Exact tabs share a cache key of
`principal/effectiveScope/rel/sitemapVersion`. Report p50/p95 from at least 20 warm local runs;
target primary content p95 under 1 second and zero duplicate exact fetches while switching tabs.

### UX hierarchy

Desktop uses a compact control-plane header, scope switcher, search/filter, surface cards, then
task-first detail sections. Mobile stacks summary and decisions, while table/diff/schema regions
scroll locally. Application defaults to intent and relationships; Agent Definition defaults to
authority/binding/runtime boundaries; Draft defaults to blockers, diff/checks, then human decision.
Raw contracts remain collapsed audit detail.

## Boundaries

No new dependency, store, event family, database table, AI renderer, Application authoring path, or
approval authority is introduced. Existing Next.js, shadcn, RJSF, Siren and Meta exec contracts are
the implementation boundary.
