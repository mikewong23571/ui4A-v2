# T20 Acceptance Evidence Contract

> Closure results are recorded in [`acceptance-report.md`](./acceptance-report.md); tracked visual
> artifacts are under [`screenshots/`](./screenshots/). This file remains the evidence schema and
> non-waivable gate contract.

## Story Record

Each U1–U22 record must identify:

```json
{
  "story": "U16",
  "principal": "local-user",
  "requestedScope": "governance",
  "effectiveScope": "governance",
  "route": "/meta/entity?rel=draft%3Aexample",
  "rel": "draft:example",
  "entityRevision": 3,
  "renderer": "draft-review",
  "actionsRendered": ["approve", "reject"],
  "actionExecuted": "approve",
  "eventsBefore": 120,
  "eventsAfter": 123,
  "desktopScreenshot": null,
  "mobileScreenshot": null,
  "accessibility": { "passed": true, "issues": [] },
  "performance": { "requests": 2, "contentMs": 300 },
  "result": "passed",
  "notes": ""
}
```

Do not store secrets, raw credentials or chain-of-thought in evidence.

## Golden Stories

1. **Application orientation**：从 `/meta` 定位 publishing，理解 intent、Flows、Capabilities、Policy，并进入 `post-status`；30 秒预算。
2. **Agent Definition explanation**：切换 governance scope，打开 author definition，指出 authority、Task/Result、runtime、tools/resources 与不可做事项；60 秒预算。
3. **Draft governance**：Authoring Run → invalid Draft → revise/validate/submit → Agent approve denied → human approve → active Definition，旧 Run birth refs 不变；90 秒决策预算不含 Provider 执行等待。
4. **Future surface**：注入 `meta/widgets` sitemap/entity fixture，零首页代码改动完成发现与 generic rendering，未声明动作无法提交。

## UX Evidence

- Desktop 1440×900 and mobile 390×844 screenshots for dashboard, Application, Agent Definition, invalid Draft, pending approval and failure states.
- Keyboard-only recording/checklist for search, navigation, tabs, revise and approve/reject.
- Task timing, clicks/page changes, hesitation/misread notes and whether raw JSON was needed.
- Visual QA: hierarchy, density, alignment, typography, status semantics, local overflow, empty/error clarity.
- Screenshots prevent regressions but do not replace human task completion evidence.

## Mechanical Safety

Any violation fails the Track regardless of visual quality:

1. Meta home or router hardcodes product rel/name inventory.
2. Unauthorized scope appears or cross-scope list/exact/action leaks identity/hash/count.
3. Functional control lacks current Siren action or skips server judgment.
4. Internal callback, actor/principal override, endpoint, key or env value becomes visible/editable.
5. Agent/system approval succeeds or human approval can half-activate.
6. Unknown class white-screens, invents facts/actions or renders unsafe HTML.
7. Refresh/replay changes displayed facts, links, version or decision status.
8. Mobile page-level overflow blocks the decision path; keyboard cannot complete approval.

## Closure Gates

- U1–U22 matrix complete; all mechanical Safety 100%.
- Three human Golden Stories meet 30/60/90-second budgets with zero Critical/High UX findings.
- `pnpm check`, `CI=true pnpm e2e`, targeted replay and action fuzz pass.
- Principal review verifies dynamic discovery, scope authorization, renderer registry, action safety, zero-AI approval and no full-App-authoring scope creep.
