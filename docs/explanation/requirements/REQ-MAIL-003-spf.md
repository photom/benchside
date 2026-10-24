# REQ-MAIL-003: Evaluate SPF

Status: Accepted

## Need

- SPF is one of the two inputs to DMARC.
- Users need to see why a sending server was or was not authorized.

## Requirement

- Evaluate SPF for the MAIL FROM and HELO identities.
- Show the include/redirect path and the term that matched.
- Warn about records that are near limits or overly permissive.

## Rationale

- SPF failures are often caused by deep `include` chains. A tree makes this visible.

## Acceptance

- RFC 7208 results are reproduced for records built in tests, including limit violations.

## Specified in

- [SPF](../../reference/mail/spf.md)
