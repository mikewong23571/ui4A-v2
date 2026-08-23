# T20 Deterministic UX Wireframes

## Dashboard

```text
Definition Control Plane                 [Scope: Publishing v]
Discover and govern application contracts       [Search...]

[Applications 6] [Flows 6] [Capabilities 6] [Drafts 0]
[Agent Definitions] [Activations] [Lifecycle]

Needs attention
Pending approvals / invalid drafts / empty state or honest failure
```

## Application

```text
Definition Management / Applications / Publishing
Content Publishing                         ACTIVE · v1
Intent sentence in readable width

2 Flows  ·  1 Capability  ·  1 Policy
[Overview] [Flows] [Capabilities] [Policies] [Provenance]
Relationship cards and direct contract-backed links
                                      [Show raw contract]
```

## Agent Definition

```text
Agent Definition Author @1                 ACTIVE
What it does / what it cannot authorize

Authority        Binding             Deployment requirement
sealed blocks    typed task data      runtime class/features (no profile secrets)

Prompt · Task/Result · Tools/Resources · Evaluation · Versions
```

## Draft Review

```text
Agent Definition Draft                     INVALID · v1
[Blocking issues first]
Candidate/effective diff · checks · Eval · sources · provenance

Decision (only when current Siren actions allow it)
[Revise form] [Validate] [Submit] / [Approve] [Reject with reason]
```

At 390 px all blocks stack. Decision controls remain after evidence in document order; large diff,
schema and table content scrolls inside its card, never at page level.
