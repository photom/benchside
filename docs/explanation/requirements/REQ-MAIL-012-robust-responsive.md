# REQ-MAIL-012: Robust and responsive analysis

Status: Accepted

## Need

- Input is hostile by nature: malformed, oversized, or crafted to hang parsers.
- The page must stay usable.

## Requirement

- Malformed input never crashes the analysis; it produces findings.
- The UI never freezes during analysis.
- Analysis of a 1 MiB message finishes in under 1 second, excluding DNS time.
- Work per analysis is bounded (size, DNS queries, time).
- A new analysis cancels the previous one.

## Rationale

- Unbounded recursion (DNS, MIME, chains) is a denial-of-service risk even in a local tool.

## Acceptance

- Fuzz-style tests with malformed input finish without uncaught errors.
- A benchmark test enforces the 1 MiB / 1 second target.

## Specified in

- [Mail analyzer limits](../../reference/mail/README.md#limits), [Input](../../reference/mail/input.md)
