# How to update the Public Suffix List snapshot

The mail analyzer bundles a snapshot of the [Public Suffix List](https://publicsuffix.org/) for DMARC under RFC 7489 ([0003](../explanation/decisions/0003-bundle-public-suffix-list.md)). A workflow proposes updates as pull requests.

## Prerequisites

- Write access to the repository.
- One-time setting: **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. Without it the workflow pushes its branch but cannot open the pull request.

## Steps

1. The workflow `Update Public Suffix List` (`.github/workflows/psl.yml`) runs every Monday. To run it now: **Actions → Update Public Suffix List → Run workflow**.
2. If the list changed, it opens a pull request from the branch `psl/<VERSION>`. If nothing changed, it stops without one.
3. Wait for CI on the pull request.
4. Merge it.

```mermaid
flowchart LR
  run[Run workflow] --> pr["Pull request psl/VERSION"] --> ci[CI green] --> merge[Merge] --> pages[Deployed with the next main build]
```

## Result

- `packages/mail/data/public_suffix_list.dat` is the new upstream file.
- RFC 7489 results show the new `VERSION` next to the organizational domain.

## If the pull request was not opened

The run log says so, and the branch `psl/<VERSION>` exists. Open the pull request from that branch by hand, or turn on the setting above and run the workflow again.
