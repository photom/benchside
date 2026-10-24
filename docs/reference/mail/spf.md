# SPF

Standard: RFC 7208.

## Evaluation

| ID | Requirement |
|---|---|
| SPF-1 | Evaluates `check_host()` for the MAIL FROM identity. If MAIL FROM is empty, uses `postmaster@<HELO name>`. |
| SPF-2 | Also evaluates `check_host()` for the HELO identity when the HELO name is a domain name. |
| SPF-3 | Results: `none`, `neutral`, `pass`, `fail`, `softfail`, `temperror`, `permerror`. |
| SPF-4 | Supports the mechanisms `all`, `include`, `a`, `mx`, `ptr`, `ip4`, `ip6`, `exists`, the modifiers `redirect` and `exp`, and macro expansion (RFC 7208 §7). |
| SPF-5 | Enforces the processing limits (RFC 7208 §4.6.4): at most 10 terms that cause DNS queries, at most 2 void lookups, at most 10 names per `mx` and per `ptr` lookup. Exceeding a limit results in `permerror`. |
| SPF-6 | Records the evaluation as a tree: each `include` and `redirect` with its record, the terms evaluated, the matching term, and the DNS queries made. |
| SPF-7 | Shows the count of DNS-querying terms and void lookups against their limits. |

## Findings

| ID | Severity | Condition |
|---|---|---|
| `spf.multiple-records` | error | More than one SPF record for a domain (`permerror`) |
| `spf.syntax` | error | The record cannot be parsed (`permerror`) |
| `spf.lookup-limit` | error | A processing limit is exceeded |
| `spf.near-lookup-limit` | warning | 8 or more DNS-querying terms |
| `spf.plus-all` | warning | The record ends in `+all` or `all` |
| `spf.ptr` | warning | The record uses `ptr` (RFC 7208 §5.5 discourages it) |
| `spf.wide-range` | warning | An `ip4` range wider than /16 or an `ip6` range wider than /32 |
