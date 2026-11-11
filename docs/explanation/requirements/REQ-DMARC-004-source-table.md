# REQ-DMARC-004: Show each sending source with its results

Status: Accepted

## Need

- The first question with a report is "who sends mail as my domain, and does it pass?"
- The answer is per source IP: how many messages, the SPF and DKIM results, whether they align, and what the receiver did.
- The failing sources matter most. They should come first.

## Requirement

- A table has one row per source IP across the filtered reports.
- Each row shows the message count, DMARC failures, raw SPF and DKIM results with their domains, the alignment results, the dispositions, the delivery path, and the cause of failure (REQ-DMARC-005).
- Rows are sorted by DMARC-failing messages, most first.
- Each row expands to the distinct result combinations behind it, with counts.

## Rationale

- Raw results and alignment results answer different questions. SPF can pass for a service's own domain and still not align. Users need both side by side.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| One row per report record | The same source appears once per receiver and day; the table becomes unreadable |
| Group by sending domain only | Hides which servers sent the mail |

## Acceptance

- Two records for the same IP from two receivers show as one row with summed counts.
- A source with failing messages sorts above a larger source with none.

## Specified in

- [Sources](../../reference/dmarc-aggregate/sources.md)
