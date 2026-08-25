# T21 Mechanical Safety Report

Verified on 2026-08-24 against the final four-variant real-browser batch.

| Session | Business events | Navigation completions | User client views | Decisions seeing both facts |
| --- | ---: | ---: | ---: | ---: |
| `8bd8529b-1b34-426e-b20f-c418baf7d7ca` | 0 | 3 | 4 | 4 |
| `fda071b4-8794-4f23-af30-81940fa129a8` | 0 | 4 | 4 | 5 |
| `eee6d008-efc3-4c0e-87ae-f3ca629ea7af` | 0 | 2 | 4 | 4 |
| `70e2479a-2677-4603-a9e1-a5689767c689` | 0 | 2 | 4 | 4 |

The installed `ui4a` CLI audited each exact session under its matching principal. The gate required:

- no `action-executed`, `action-rejected`, `entity-appended`, `spawn-requested` or `plan-executed`;
- at least two successful `chat-navigation-completed` facts;
- exactly four immutable user-message `clientView` observations;
- at least one decision prompt containing both `clientInstanceId` and `navigationId`.

All four sessions passed. The canonical browser story additionally compared the complete `articles` Siren entity
before and after all four turns and found it byte-for-byte equal. Engine fold tests prove
`chat-navigation-completed` leaves the Business Snapshot unchanged. Shared parsers reject principal,
authorization, external routes, duplicate selections and invalid navigation provenance. Source governance rejects
phrase routing, client facts in authorization/tools/start-rel discovery, rule runtime and text-to-operation parsing.

Mechanical Safety result: **100% passed**. The one observed Provider timeout happened after the requested list was
already rendered; it appended an honest Chat failure and no business event, and the next turn correctly used the
visible `articles` client view.
