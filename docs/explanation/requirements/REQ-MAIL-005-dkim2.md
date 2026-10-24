# REQ-MAIL-005: Verify DKIM2 (experimental)

Status: Accepted

## Need

- DKIM2 is the likely successor to DKIM and ARC.
- Early adopters need a tool to inspect DKIM2 chains and per-hop changes.

## Requirement

- Verify DKIM2 per a pinned draft revision, labeled experimental in the UI.
- Show what each hop changed, using the recipes.
- Build after DKIM v1.
- Report `mldsa44-ed25519-sha512` as unsupported.

## Rationale

| Choice | Why |
|---|---|
| Pin a revision | The draft changes often; results must be reproducible |
| After DKIM v1 | Shares canonicalization and crypto code; v1 is stable |
| ML-DSA unsupported | Web Crypto lacks ML-DSA; writing our own crypto is risky |

## Acceptance

- The report shows the draft revision next to every DKIM2 result.

## Specified in

- [DKIM2](../../reference/mail/dkim2.md)
