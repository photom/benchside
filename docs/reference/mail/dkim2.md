# DKIM2

Standards: [draft-ietf-dkim-dkim2-spec-07](https://datatracker.ietf.org/doc/html/draft-ietf-dkim-dkim2-spec-07) and [draft-ietf-dkim-dkim2-dns-02](https://datatracker.ietf.org/doc/draft-ietf-dkim-dkim2-dns/).

**Experimental.** DKIM2 is an Internet-Draft and changes between revisions. This page is pinned to the revisions above. The report labels DKIM2 results as experimental and states the draft revision.

## Parsing

| ID | Requirement |
|---|---|
| DKIM2-1 | Parses `Message-Instance` fields (`m=`, `h=`, `r=`) and `DKIM2-Signature` fields (`i=`, `m=`, `t=`, `mf=`, `rt=`, `nd=`, `d=`, `s=`, `f=`, `n=`). |
| DKIM2-2 | A tag list with a duplicate tag name is invalid (`permerror`). Unknown tags are ignored. |
| DKIM2-3 | Missing required tags give `permerror`. Required: `m=` and `h=` in `Message-Instance`; `i=`, `m=`, `t=`, `d=`, `s=`, and either `nd=` or both `mf=` and `rt=` in `DKIM2-Signature`. |
| DKIM2-4 | `i=` and `m=` numbering must start at 1 and have no gaps (`permerror`). |

## Verification

| ID | Requirement |
|---|---|
| DKIM2-5 | Supports `rsa-sha256` and `ed25519-sha256`, and the hash algorithms `sha256` and `sha512`. |
| DKIM2-6 | `mldsa44-ed25519-sha512` signatures are reported with `dkim2.unsupported-algorithm` and are not evaluated. Browsers' Web Crypto does not yet provide ML-DSA. |
| DKIM2-7 | Computes header and body hashes as the draft defines and compares them with the highest `Message-Instance`. |
| DKIM2-8 | Applies the recipes in `r=` from the highest `Message-Instance` downwards to rebuild earlier versions of the message, and checks each version's hashes. A body recipe of `null` means the earlier body cannot be rebuilt; the earlier body hash is then not evaluated. |
| DKIM2-9 | Shows the changes made at each hop as a diff between rebuilt versions. |
| DKIM2-10 | Verifies the cryptographic signature of every `DKIM2-Signature`. Keys are looked up at `<selector>._domainkey.<d=>`, and the key's algorithm must match the algorithm in `s=`. |
| DKIM2-11 | Checks the chain of custody: `mf=` and `rt=` between consecutive signatures, `nd=`, and `d=` against the `mf=` domain, using the draft's relaxed domain match. |
| DKIM2-12 | Checks the highest signature's `mf=` and `rt=` against the [delivery details](input.md#delivery-details). If they are not available, this check is not evaluated. |
| DKIM2-13 | Checks that the `From` domain relaxed-matches the `d=` of the relevant signature, as the draft defines. |
| DKIM2-14 | Reports two stages: provisionally verified (the highest signature and the highest `Message-Instance` hashes verify) and validly signed (all checks pass). |
| DKIM2-15 | Results: `pass`, `fail`, `permerror`, `temperror`, or not evaluated. |

## Findings

| ID | Severity | Condition |
|---|---|---|
| `dkim2.unsupported-algorithm` | info | An algorithm in `s=` is not supported |
| `dkim2.numbering-gap` | error | A gap in `i=` or `m=` numbering |
| `dkim2.hash-mismatch` | error | A header or body hash does not match |
| `dkim2.recipe-invalid` | error | A recipe cannot be decoded or applied |
| `dkim2.custody-broken` | error | The chain of custody check fails |
| `dkim2.envelope-mismatch` | error | The highest signature does not match the delivery details |
| `dkim2.from-mismatch` | error | The `From` domain does not match the relevant `d=` |
