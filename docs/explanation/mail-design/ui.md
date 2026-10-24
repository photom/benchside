# UI

Requirements: [REQ-MAIL-002](../requirements/REQ-MAIL-002-explain-results.md), [REQ-MAIL-009](../requirements/REQ-MAIL-009-delivery-details.md), [REQ-MAIL-010](../requirements/REQ-MAIL-010-dns-control.md).

## Layout

```
┌──────────────────┬───────────────────────────┬────────────────────────────┐
│ InputPanel       │ OptionsPanel              │ EnvelopePanel              │
│ drop / paste     │ DMARC mode, DoH, offline, │ IP, HELO, MAIL FROM,       │
│                  │ sensitive queries, time   │ RCPT TO, boundary picker   │
├──────────────────┴───────────────────────────┴────────────────────────────┤
│ Summary: SPF pass · DKIM 1 pass 1 fail · DKIM2 none · DMARC pass · ARC none │
├──────────────────────────────────────────────┬────────────────────────────┤
│ MethodDetail                                 │ SourceView                 │
│   TraceTree                                  │   header block,            │
│   FindingList                                │   highlighted evidence     │
├──────────────────────────────────────────────┼────────────────────────────┤
│ DnsLog                                       │ ExportButton               │
└──────────────────────────────────────────────┴────────────────────────────┘
```

## Component tree

```mermaid
flowchart TD
  App --> InputPanel & OptionsPanel & EnvelopePanel & Summary
  Summary --> MethodDetail
  MethodDetail --> TraceTree & FindingList
  App --> SourceView & DnsLog & ExportButton
  TraceTree & FindingList & DnsLog -- "select(evidence)" --> SourceView
```

## Evidence selection

```mermaid
sequenceDiagram
  actor U as User
  participant F as FindingList
  participant S as store
  participant V as SourceView

  U->>F: click finding
  F->>S: select(evidence[0])
  S-->>V: selected = bytes(1203, 1290)
  V->>V: scroll line into view, highlight range
  V-->>U: focus moves to highlighted line
```

| Evidence | Target |
|---|---|
| `header` | SourceView, whole field |
| `bytes` | SourceView, exact range |
| `dns` | DnsLog row |

## SourceView

| Concern | Design |
|---|---|
| Size | Header block only by default; body on demand |
| Rendering | Virtual scrolling: fixed line height, render visible lines + 20 above and below |
| Text | `TextDecoder('utf-8', { fatal: false })` per line; control characters shown as `␍`, `␊`, `·` |
| Highlight | Ranges mapped to (line, column) by binary search over line starts |

## Accessibility

| Rule |
|---|
| Every result shows a text label, not only color |
| Summary lines are buttons; Enter expands |
| Trace is a `tree` role with arrow-key navigation |
| Selecting evidence moves focus to SourceView and announces the field name |
| Experimental results (DKIM2) carry a visible "experimental" label |
