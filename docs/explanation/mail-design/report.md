# Report

Spec: [Report](../../reference/mail/report.md).

## Build (`build.ts`)

```mermaid
flowchart LR
  r[/check results/] --> flat["collect findings<br/>assign key f1, f2, …"]
  flat --> map["map bytes evidence<br/>toOriginal()"]
  map --> sum["summary.ts<br/>SUM-1..5"]
  sum --> rep[/Report/]
  log[/DNS log/] --> rep
```

- Keys follow emission order, so the same input gives the same keys.
- `bytes` evidence is converted once here. Checks never see original offsets.

## Export (`export.ts`)

```mermaid
flowchart LR
  rep[/Report/] --> pick["build export object<br/>from an allowlist of fields"]
  pick --> opt{opt-in?}
  opt -->|yes| add["add message.headers"]
  opt -->|no| skip[nothing more]
  add & skip --> json["JSON.stringify<br/>(stable key order)"]
```

| Rule | Why |
|---|---|
| Allowlist, not deny-list | A new field never leaks message text by accident |
| Trace labels that quote message text are marked `quotes: true` at creation and dropped without opt-in | EXP-2 |
| Stable key order | Exports diff cleanly |

A test serializes a report built from a message full of a unique marker string, then asserts the marker does not appear in the export without opt-in.
