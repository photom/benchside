# REQ-MAIL-007: Validate ARC

Status: Accepted

## Need

- Mailing lists and forwarders break DKIM and SPF.
- ARC lets them vouch for the original results. Users need to see that chain.

## Requirement

- Validate the ARC chain per RFC 8617.
- Show one row per hop: who sealed it, when, and what that hop concluded.
- Show the oldest hop whose signature still verifies.

## Rationale

- The hop-by-hop view shows where a message was modified.

## Acceptance

- Chains of 1, 2, and 50 sets built in tests validate; each structural defect gives `fail` with its own finding.

## Specified in

- [ARC](../../reference/mail/arc.md)
