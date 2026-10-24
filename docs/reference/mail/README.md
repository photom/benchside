# Mail analyzer

The mail analyzer reads a message and evaluates its authentication: SPF, DKIM, DKIM2, DMARC, and ARC. It compares its own results with the results the receiving server recorded.

Each requirement has an ID (for example `SPF-3`). Tests refer to these IDs.

## Standards

| Area | Standard | Notes |
|---|---|---|
| Message format | RFC 5322, RFC 2045–2047, RFC 6532 | |
| SPF | RFC 7208 | |
| DKIM | RFC 6376, RFC 8301, RFC 8463 | |
| DKIM2 | draft-ietf-dkim-dkim2-spec-07, draft-ietf-dkim-dkim2-dns-02 | Experimental. Pinned to these revisions |
| DMARC | RFC 7489, RFC 9989 | The user selects which one to apply |
| ARC | RFC 8617 | |
| Receiver results | RFC 8601 | |

## Pages

- [Input](input.md) — accepted input and delivery details
- [DNS](dns.md) — how records are looked up
- [SPF](spf.md)
- [DKIM](dkim.md)
- [DKIM2](dkim2.md)
- [DMARC](dmarc.md)
- [ARC](arc.md)
- [Results](results.md) — receiver results, report format, and non-functional requirements

## Out of scope

- Signing messages
- Sending DMARC reports
- BIMI, MTA-STS, DANE
- S/MIME and OpenPGP
- Inspecting attachments (planned for the ZIP and PDF tools)
