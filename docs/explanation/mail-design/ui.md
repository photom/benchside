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

## Current build (DKIM, ARC)

The full layout above is the target. The page grows towards it method by method.

```mermaid
flowchart TD
  App --> Summary["Summary<br/>one line per method (SUM-2, SUM-5)"]
  App --> Receiver[Receiver results]
  App --> Dkim["DkimDetail<br/>one card per signature"]
  App --> Arc["ArcDetail<br/>one row per hop"]
  App --> Notes["Notes<br/>findings of no single result"]
  App --> Headers["Header fields<br/>id=field-N"]
  App --> DnsLog["DnsLog<br/>id=dns-qN"]
  Dkim & Arc -- "evidence link" --> Headers & DnsLog
```

| Element | Shows | REQ |
|---|---|---|
| Summary | `DKIM: pass (1 pass, 1 fail)`; `none` without signatures. `ARC: pass (2 sets)`. A `not-evaluated` reason comes before the counts: `ARC: not evaluated (offline; 1 set)` | REQ-MAIL-002, SUM-2, SUM-5 |
| DKIM card | `d=`, `s=`, result as text, the `not-evaluated` reason, findings with severity | REQ-MAIL-002, REQ-MAIL-004 |
| Trace (`<details>`) | Tags, signed header fields, key query, header hash input, body hash computed vs `bh=` | DKIM-16 |
| Canonical body | Shown open when the computed body hash differs from `bh=`; marked when only the first 64 KiB is shown | REQ-MAIL-004 |
| ARC chain | Chain result in words with its reason; the oldest hop whose message signature still verifies (ARC-6); the chain's findings; a table with one row per hop: instance, sealer `d=` and `s=` and seal time (`t=` in UTC, as written when it is not decimal seconds; from the message signature when the seal is missing), `cv=`, message signature result, seal result, the hop's own results (AAR authserv-id and its entries worded as in receiver results, or "(no results)"), links to the ARC fields and key queries | REQ-MAIL-007, ARC-10 |
| Evidence | In-page links: `header` → the header list item, `dns` → the DNS log row. Every finding list (DKIM, ARC, receiver results, Notes) uses the same `FindingList` view | REQ-MAIL-002 |
| DNS log | Query ID, name, type, result, DNSSEC flag (`n/a` when no answer was received), cache hit, purpose | DNS-15 |

- Result words are always text; color is only a second cue.
- `not-evaluated` reads "Not evaluated (offline)", never like a failure.
- Views live in `apps/mail/src/views/`; `summarizeDkim` (SUM-2) lives in the package.
