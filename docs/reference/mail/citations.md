# Citations

The standard behind each evaluation step, as shown on the page ([REQ-MAIL-014](../../explanation/requirements/REQ-MAIL-014-cite-standards.md)). The rules themselves are in the method pages.

| ID | Rule |
|---|---|
| CITE-1 | Each method section on the page lists the steps below, in order, under "How this is checked". Each step shows its text, its links, and its reason exactly as written here. |
| CITE-2 | A link reads `RFC <number> §<section>` (or `Appendix <x>`) and points at `https://www.rfc-editor.org/rfc/rfc<number>#section-<section>` (or `#appendix-<x>`). A link without a section points at the RFC. |
| CITE-3 | The References section lists every RFC in the table at the end of this page, in that order, with its number, title, and link. |
| CITE-4 | Links open in a new tab with `rel="noreferrer"`. They are navigation only: nothing is fetched. |

## Delivery details

| Step | Standard | Why |
|---|---|---|
| Find the trust boundary in the Received fields, newest first | RFC 5321 §4.4 | Each mail server adds its Received field on top, so the top fields come from the receiving side. |
| Take the client IP and HELO from the boundary Received field | RFC 5321 §4.4 | The from clause records the connecting host's address and HELO name. |
| Take MAIL FROM from Return-Path | RFC 5321 §4.4 | The delivering server records the reverse-path in Return-Path. |
| Take the reference time: the boundary field's date by default, or the Date field or the current time when chosen | RFC 5322 §3.3 | Signature times are checked against when the message arrived, not against today. |

## SPF

| Step | Standard | Why |
|---|---|---|
| Check the MAIL FROM and HELO identities | RFC 7208 §2.3, RFC 7208 §2.4 | SPF authorizes these two identities. A null reverse-path uses postmaster at the HELO domain. |
| Check that the domain is usable | RFC 7208 §4.3 | A malformed domain gives none without a lookup. |
| Look up and select the SPF record | RFC 7208 §4.4, RFC 7208 §4.5 | One TXT record starting with v=spf1. None gives none; more than one gives permerror. |
| Evaluate the terms left to right | RFC 7208 §4.6 | The first mechanism that matches decides, with its qualifier. |
| Evaluate each mechanism | RFC 7208 §5 | all, include, a, mx, ptr, ip4, ip6, and exists each match in their own way. |
| Apply redirect and exp | RFC 7208 §6.1, RFC 7208 §6.2 | redirect hands evaluation to another domain; exp explains a fail. |
| Expand macros | RFC 7208 §7 | Names in terms can depend on the sender and client. |
| Enforce the DNS lookup limits | RFC 7208 §4.6.4 | At most 10 DNS-querying terms and 2 void lookups, to bound DNS load. |
| Name the result | RFC 7208 §2.6 | none, neutral, pass, fail, softfail, temperror, permerror. |

## DKIM

| Step | Standard | Why |
|---|---|---|
| Parse the DKIM-Signature tags | RFC 6376 §3.2, RFC 6376 §3.5 | The signature is a tag=value list with required tags. |
| Validate the signature field | RFC 6376 §6.1.1 | Version, required tags, From signed, and expiry are checked before any lookup. |
| Accept only allowed algorithms | RFC 8301 §3.1, RFC 8463 | rsa-sha1 must not be accepted; ed25519-sha256 is allowed. |
| Get the public key | RFC 6376 §6.1.2, RFC 6376 §3.6.2 | The key is a TXT record at selector._domainkey.domain. |
| Check the key size | RFC 8301 §3.2 | RSA keys shorter than 1024 bits are not accepted. |
| Canonicalize and hash the body | RFC 6376 §3.4.3, RFC 6376 §3.4.4, RFC 6376 §3.7 | The body hash must equal bh=, or the body was changed. |
| Select and canonicalize the signed header fields | RFC 6376 §5.4.2, RFC 6376 §3.4.1, RFC 6376 §3.4.2 | Fields listed in h= are taken bottom-up, so added fields cannot replace signed ones. |
| Verify the signature | RFC 6376 §6.1.3 | The signature over the header data must verify with the key. |

## DMARC (RFC 9989)

| Step | Standard | Why |
|---|---|---|
| Extract the author domain from From | RFC 9989 §5.3.1 | DMARC protects the domain the reader sees. |
| Discover the policy record with the DNS tree walk | RFC 9989 §4.10.1, RFC 9989 §5.3.2 | The record at the author domain, else the closest one above it. |
| Find the organizational domain | RFC 9989 §4.10.2 | Relaxed alignment compares organizational domains. |
| Collect the authenticated identifiers | RFC 9989 §5.3.3 | The SPF MAIL FROM domain and each DKIM d= domain, with their results. |
| Check identifier alignment | RFC 9989 §5.3.4, RFC 9989 §4.4 | An identifier counts only if it matches the author domain, strictly or relaxed. |
| Decide pass or fail | RFC 9989 §5.3.5 | Pass needs one aligned identifier that passed. |
| Read the policy tags | RFC 9989 §4.7 | p, sp, np, and t say what the domain owner asks for. |
| Test whether the author domain exists | RFC 9989 Appendix A.4 | np applies to domains that do not exist. |
| Apply the policy | RFC 9989 §5.3.6 | A failing message gets the policy in effect; DNS errors mean no policy applies. |

## DMARC (RFC 7489)

| Step | Standard | Why |
|---|---|---|
| Extract the author domain from From | RFC 7489 §6.6.1 | DMARC protects the domain the reader sees. |
| Find the organizational domain with the Public Suffix List | RFC 7489 §3.2 | The public suffix plus one label. |
| Discover the policy record | RFC 7489 §6.6.3 | The author domain, then its organizational domain. |
| Read the record tags | RFC 7489 §6.3 | p, sp, pct, adkim, aspf, and the rest, with their defaults. |
| Check identifier alignment | RFC 7489 §3.1 | An identifier counts only if it matches the author domain, strictly or relaxed. |
| Decide pass or fail and the policy | RFC 7489 §6.6.2 | Pass needs one aligned identifier that passed; otherwise the policy applies. |
| Apply pct sampling | RFC 7489 §6.6.4 | pct below 100 applies the policy to only part of the failing mail. |

## ARC

| Step | Standard | Why |
|---|---|---|
| Collect the ARC sets | RFC 8617 §5.2, RFC 8617 §4.2.1 | Sets group by i=; more than 50 fails the chain. |
| Check the newest seal's cv | RFC 8617 §5.2 | A sealer that already saw a failed chain marked it cv=fail. |
| Validate the chain structure | RFC 8617 §5.2, RFC 8617 §4.4 | One AAR, AMS, and AS per set, instances 1 to N, cv=none only on the first. |
| Verify the newest message signature | RFC 8617 §4.1.2, RFC 8617 §5.2 | It is verified like a DKIM signature; a failure fails the chain. |
| Find the oldest hop that still verifies | RFC 8617 §5.2 | Older message signatures show where the message was last changed. |
| Verify every seal | RFC 8617 §4.1.3, RFC 8617 §5.2 | Each seal covers all sets up to it; any failure fails the chain. |

## Receiver results

| Step | Standard | Why |
|---|---|---|
| Parse Authentication-Results | RFC 8601 §2.2 | Each field holds an authserv-id and method=result entries. |
| Trust only fields from inside the trust boundary | RFC 8601 §1.2, RFC 8601 §5 | Anyone can add the field; only the receiving side's own fields are believable. |

## References

| RFC | Title |
|---|---|
| RFC 5321 | Simple Mail Transfer Protocol |
| RFC 5322 | Internet Message Format |
| RFC 7208 | Sender Policy Framework (SPF) for Authorizing Use of Domains in Email, Version 1 |
| RFC 6376 | DomainKeys Identified Mail (DKIM) Signatures |
| RFC 8301 | Cryptographic Algorithm and Key Usage Update to DomainKeys Identified Mail (DKIM) |
| RFC 8463 | A New Cryptographic Signature Method for DomainKeys Identified Mail (DKIM) |
| RFC 9989 | Domain-Based Message Authentication, Reporting, and Conformance (DMARC) |
| RFC 7489 | Domain-based Message Authentication, Reporting, and Conformance (DMARC) |
| RFC 8617 | The Authenticated Received Chain (ARC) Protocol |
| RFC 8601 | Message Header Field for Indicating Message Authentication Status |
