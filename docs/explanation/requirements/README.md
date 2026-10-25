# Requirements

What users need and why. Each record is written like an ADR.

```mermaid
flowchart LR
  req[Requirement<br/><i>what + why</i>] -- "specified by" --> spec[Specification<br/>docs/reference]
  req -- "constrains" --> adr[Design decision<br/>decisions/]
  req -- "acceptance criteria" --> test[Tests]
  spec -- "rules → scenarios" --> test
```

| Status | Meaning |
|---|---|
| Proposed | Under discussion |
| Accepted | Agreed; specs and tests follow it |
| Superseded | Replaced by another record (linked) |

## Mail analyzer

| ID | Title | Status |
|---|---|---|
| [REQ-MAIL-001](REQ-MAIL-001-local-only.md) | Analyze messages without sending them anywhere | Accepted |
| [REQ-MAIL-002](REQ-MAIL-002-explain-results.md) | Explain every result with evidence | Accepted |
| [REQ-MAIL-003](REQ-MAIL-003-spf.md) | Evaluate SPF | Accepted |
| [REQ-MAIL-004](REQ-MAIL-004-dkim.md) | Verify DKIM | Accepted |
| [REQ-MAIL-005](REQ-MAIL-005-dkim2.md) | Verify DKIM2 (experimental) | Accepted |
| [REQ-MAIL-006](REQ-MAIL-006-dmarc.md) | Evaluate DMARC under both versions | Accepted |
| [REQ-MAIL-007](REQ-MAIL-007-arc.md) | Validate ARC | Accepted |
| [REQ-MAIL-008](REQ-MAIL-008-receiver-results.md) | Compare with the receiver's results | Accepted |
| [REQ-MAIL-009](REQ-MAIL-009-delivery-details.md) | Inferred, editable delivery details | Accepted |
| [REQ-MAIL-010](REQ-MAIL-010-dns-control.md) | Control what DNS lookups reveal | Accepted |
| [REQ-MAIL-011](REQ-MAIL-011-export.md) | Export the report | Accepted |
| [REQ-MAIL-012](REQ-MAIL-012-robust-responsive.md) | Robust and responsive analysis | Accepted |
| [REQ-MAIL-013](REQ-MAIL-013-show-used-header-fields.md) | Show the header fields the checks read | Accepted |
| [REQ-MAIL-014](REQ-MAIL-014-cite-standards.md) | Cite the standard behind each step | Accepted |
