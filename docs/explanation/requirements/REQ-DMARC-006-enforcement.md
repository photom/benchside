# REQ-DMARC-006: Show what a stricter policy would change

Status: Accepted

## Need

- Owners publish `p=none` first, read reports, and then decide on `quarantine` or `reject` (RFC 9989 §5.1.5 to §5.1.7).
- The question is: "If I enforce now, whose legitimate mail gets hurt?"
- RFC 9989 §7.4 adds a second question: does the domain rely on SPF alone? Mail that passes only through SPF fails once it is forwarded.

## Requirement

- For each policy domain, show the policy in effect and any changes in the period.
- Show the failing messages that `quarantine` or `reject` would affect, split by delivery path.
- Show the direct sources that fail, since they are the ones to fix first.
- Show how many passing messages pass through SPF alone, without aligned DKIM.
- Show failing messages that receivers did not act on, with their override reasons.
- Give a plain status from fixed rules, with no score.

## Rationale

- Direct failures are usually the owner's own senders. RFC 9989 §5.1.6 says these MUST be fixed before enforcement.
- Forwarded failures are the known cost of enforcement (RFC 9989 §7.4).
- Fixed rules can be tested and explained. A score would hide the judgment.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A single "ready" percentage | Hides which sources block enforcement |
| Model `pct` rollouts | `pct` is removed in RFC 9989 (Appendix A.6) |

## Acceptance

- A domain with one failing direct source shows the status `fix-direct` and lists that source.
- A domain whose only failures are forwarded and other, and with no SPF-only passes, shows `check-forwarded`.
- A domain where every pass is SPF-only shows that count, and the status `add-dkim` unless a direct source fails.

## Specified in

- [Enforcement](../../reference/dmarc-aggregate/enforcement.md)
