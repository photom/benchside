# 0003: Bundle the Public Suffix List

## Context

DMARC under RFC 7489 finds the organizational domain with a public suffix list. RFC 9989 replaces this with a DNS tree walk, but RFC 7489 is still widely deployed, and the mail analyzer supports both (see [DMARC](../../reference/mail/dmarc.md)).

The [Public Suffix List](https://publicsuffix.org/) changes several times a month. Options:

- Fetch it at run time. This adds another origin to the CSP and tells a third party when the tool is used.
- Fetch it at build time. Builds would no longer be reproducible.
- Commit a snapshot to the repository and update it regularly.

## Decision

- Commit a snapshot of the list to `packages/mail` and bundle it into the mail app.
- A scheduled GitHub Actions workflow opens a pull request when the upstream list changes.
- The report shows the snapshot date and the list entry that matched.
- Use the whole list, both the ICANN and private sections.

## Consequences

- No extra network access, and builds are reproducible.
- The mail app grows by roughly 200 KB before compression.
- Results can differ from a receiver's if their copy of the list is older or newer. The snapshot date in the report makes this visible.
- The list is licensed under MPL 2.0. The snapshot keeps its license header, and the README credits it.
