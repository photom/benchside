# DMARC

Standards: RFC 7489 and RFC 9989 (DMARCbis). RFC 9989 obsoletes RFC 7489, but RFC 7489 is still widely deployed, so both are supported.

## Version selection

| ID | Requirement |
|---|---|
| DMARC-1 | The user selects the version to apply: RFC 9989 (default) or RFC 7489. The report can show both side by side. |

## Organizational domain

| ID | Requirement |
|---|---|
| DMARC-2 | RFC 9989: finds the policy and the organizational domain with the DNS tree walk (RFC 9989 §4.10): at most 8 queries, starting below 8 labels, using `psd=` to choose the organizational domain. |
| DMARC-3 | RFC 7489: finds the organizational domain with the Public Suffix List (see [0003](../../explanation/decisions/0003-bundle-public-suffix-list.md)). The report shows the matching list entry and the date of the list snapshot. |

## Record

| ID | Requirement |
|---|---|
| DMARC-4 | Looks up `_dmarc.<domain>`. A record must start with `v=DMARC1`. Multiple records at one name are all discarded. |
| DMARC-5 | Parses the tags of the selected version. Common: `v`, `p`, `sp`, `adkim`, `aspf`, `rua`, `ruf`, `fo`. RFC 9989 only: `np`, `psd`, `t`. RFC 7489 only: `pct`, `rf`, `ri`. Tags that the selected version does not define are ignored and reported with `dmarc.ignored-tag`. |
| DMARC-6 | Applies each version's rules for a missing or invalid `p` (RFC 9989: a missing `p` is treated as `none`; an invalid value is treated as `none` if a valid `rua` exists, otherwise DMARC is not applied). |

## Evaluation

| ID | Requirement |
|---|---|
| DMARC-7 | Extracts the author domain from `From`. Zero, several `From` fields, or several addresses in `From` result in `dmarc.from-invalid` and no evaluation. |
| DMARC-8 | Shows identifier alignment as a table: the author domain against the SPF MAIL FROM domain and against the `d=` of each DKIM signature, in relaxed and strict mode, with the mode in effect highlighted. |
| DMARC-9 | DMARC passes if an SPF `pass` or a DKIM `pass` is aligned. DKIM2 results are shown separately and do not count towards DMARC. |
| DMARC-10 | Determines the policy in effect: `p` for the author domain; `sp` for an existing subdomain; with RFC 9989, `np` for a non-existent subdomain (NXDOMAIN). |
| DMARC-11 | Applies `t=y` (RFC 9989: lower the policy one level) or `pct` (RFC 7489: the policy applies to that percentage of messages; the report states this instead of choosing randomly). |
| DMARC-12 | Results: `pass`, `fail`, `none` (no record), `temperror`, `permerror`, with the resulting disposition `none`, `quarantine`, or `reject`. |
| DMARC-13 | Shows `rua` and `ruf` addresses. The analyzer never sends reports. |

## Findings

| ID | Severity | Condition |
|---|---|---|
| `dmarc.from-invalid` | error | No single author domain can be determined |
| `dmarc.multiple-records` | error | More than one record at one name |
| `dmarc.ignored-tag` | info | A tag the selected version does not define |
| `dmarc.policy-none` | info | The policy in effect is `none` |
| `dmarc.no-rua` | info | No aggregate report address |
