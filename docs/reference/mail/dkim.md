# DKIM

Standards: RFC 6376, updated by RFC 8301 (algorithms and key sizes) and RFC 8463 (Ed25519).

## Verification

| ID | Requirement |
|---|---|
| DKIM-1 | Verifies each `DKIM-Signature` field independently and reports one result per signature: `pass`, `fail`, `neutral`, `temperror`, `permerror`, or not evaluated. |
| DKIM-2 | Verifies at most 20 signatures per message. Further signatures are reported with `dkim.too-many-signatures`. |
| DKIM-3 | Supports `simple` and `relaxed` canonicalization for both header and body. |
| DKIM-4 | Supports `rsa-sha256` and `ed25519-sha256`. `rsa-sha1` signatures are computed but the result is `fail` with `dkim.sha1` (RFC 8301 §3.1). |
| DKIM-5 | RSA keys shorter than 1024 bits give `permerror` (RFC 8301 §3.2). |
| DKIM-6 | Looks up the key at `<s=>._domainkey.<d=>` and supports the key tags `v`, `h`, `k`, `n`, `p`, `s`, `t`. An empty `p=` means the key is revoked (`permerror`). |
| DKIM-7 | Checks `x=` (expiration) and `t=` (signing time) against the [reference time](input.md#reference-time). A signature whose `x=` is before the reference time fails with `dkim.expired`. |
| DKIM-8 | Checks that `i=`, if present, is in `d=` or a subdomain of it, and that it is not a subdomain when the key has `t=s`. |
| DKIM-9 | Supports `l=` (body length). |
| DKIM-10 | When the body hash does not match, shows the canonicalized body that was hashed, so the user can see the difference. |
| DKIM-11 | Shows the canonicalized header data that was signed. |

## Findings

| ID | Severity | Condition |
|---|---|---|
| `dkim.sha1` | error | `a=rsa-sha1` |
| `dkim.key-revoked` | error | Empty `p=` |
| `dkim.expired` | error | `x=` is before the reference time |
| `dkim.body-hash-mismatch` | error | The computed body hash differs from `bh=` |
| `dkim.signature-mismatch` | error | The signature does not verify |
| `dkim.too-many-signatures` | warning | More than 20 signatures |
| `dkim.body-length` | warning | `l=` is present; content can be appended after signing |
| `dkim.from-not-oversigned` | warning | `h=` does not list `from` more times than `From` fields exist, so another `From` field could be added |
| `dkim.unsigned-header` | warning | `Subject`, `Date`, `To`, `Cc`, `Reply-To`, `Message-ID`, or `Content-Type` is present but not signed |
| `dkim.weak-key` | warning | RSA key shorter than 2048 bits |
| `dkim.testing` | info | The key has `t=y` |
| `dkim.future-timestamp` | warning | `t=` is after the reference time |
