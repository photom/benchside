# REQ-DMARC-007: Visualize the combined reports

Status: Accepted

## Need

- XML reports are not readable in bulk (RFC 9990 §9.2).
- Users want the state at a glance: volume, pass rate, trend, paths, causes, and receivers.

## Requirement

- A row of headline numbers: messages, DMARC pass rate, failing messages, reports, reporters, period.
- Messages per day by delivery path, and the DMARC pass rate per day.
- The split of messages by delivery path.
- Failing messages by cause.
- Messages and pass rate per reporter.
- Every chart has a table view, and its categories are named in text, not by color alone.
- Selecting a path or cause in a chart filters the source table.
- The charts follow the filters of REQ-DMARC-003.

## Rationale

- Each chart answers one question users ask in order: how much, is it getting better, which path, why it fails, who reports.
- Charts are drawn in-house as SVG to keep runtime dependencies at zero and the CSP strict.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A chart library | Adds a large runtime dependency; some need inline styles the CSP blocks |
| Pie or donut charts | Harder to compare than bars |
| One chart with two y-axes for volume and pass rate | Two scales mislead; two charts on a shared time axis instead |

## Acceptance

- Each chart has a table view with the same numbers.
- Changing the domain filter redraws every chart.
- Selecting "forwarded" in the path chart filters the source table to forwarded rows.

## Specified in

- Data: [Combining reports](../../reference/dmarc-aggregate/combine.md), [Classification](../../reference/dmarc-aggregate/classify.md)
- Display: [DMARC aggregate report UI design](../dmarc-aggregate-design/ui.md)
