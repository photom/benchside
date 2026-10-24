# REQ-MAIL-004: Verify DKIM

Status: Accepted

## Need

- DKIM is the most robust DMARC input.
- When it fails, users need to know which part broke: body, headers, or key.

## Requirement

- Verify every DKIM signature, with current algorithm rules (RFC 8301, RFC 8463).
- On a body hash mismatch, show the canonicalized body that was hashed.
- Warn about signatures an attacker could abuse (`l=`, unsigned or non-oversigned headers).

## Rationale

- Canonicalized data is what the signer hashed. Showing it turns a mysterious failure into a visible diff.

## Acceptance

- Signatures generated in tests verify for all canonicalization and algorithm combinations.
- Each listed permerror case produces its own finding.

## Specified in

- [DKIM](../../reference/mail/dkim.md)
