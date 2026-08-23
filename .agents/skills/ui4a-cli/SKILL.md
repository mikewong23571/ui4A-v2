---
name: ui4a-cli
description: Use the installed ui4a CLI to discover, read, operate, audit, or submit governed Draft changes to a UI4A application. Do not use it as an approval shortcut or as a replacement for application reasoning.
---

# UI4A CLI

Verify the installed client and current connection first:

```bash
command -v ui4a
ui4a --json doctor
ui4a --help
```

Use `--json` for decisions and piping. Discover before naming resources:

```bash
ui4a --json apps list
ui4a --json flows list
ui4a --json entities get <rel>
ui4a --json actions list <rel>
```

For a business action, re-read the Entity and its current Siren action schema. Use `--dry-run`
before a live effect when the user has not already authorized that exact effect. Rejections are
structured application facts; re-observe and repair the request instead of bypassing them.

For definition/content improvements, export the current Bundle, edit outside the CLI, then enter the
candidate through a governed Draft:

```bash
ui4a --json bundles export <application> --out /tmp/application.json
ui4a --json drafts create --kind flow-definition --target <flow> \
  --payload-file /tmp/flow.json --command-id <stable-id>
ui4a --json drafts validate <draft-id>
ui4a --json drafts diff <draft-id>
ui4a --json drafts submit <draft-id>
```

Read Draft/activation state or resume audit with `drafts get`, `drafts watch`, `activations get`, and
`audit draft`. The CLI intentionally cannot approve/reject human decisions, override
SubmissionPolicy, impersonate a principal, or issue raw writes. `request get|head` is a read-only
repair hatch. Never replace these boundaries with curl or direct database access.
