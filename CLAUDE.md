# benchside

A set of small browser-only tools for taking files apart and looking inside them (email headers and authentication, ZIP, PDF, and more). User files are never sent anywhere. The only outbound traffic is DNS-over-HTTPS lookups, which contain domain names only.

Everything in this repository — code, comments, docs, skills, commit messages — is written in English.

## Tech stack

TypeScript + Vite (multi-page), Preact for the UI, vitest for tests. Node is used only for building and testing during development; the deliverable is static files on GitHub Pages.

- Parsers and analysis logic are pure, DOM-independent TypeScript (`packages/*`). The UI (`apps/web`) only displays their results.
- Keep runtime dependencies to a minimum. Write parsers in-house.
- Each page's CSP restricts `connect-src` to the DoH endpoints.

## Workflow (always in this order)

1. **Write the docs**: before implementing, describe the behavior in docs/. This applies to every new feature, new check, and behavior change.
2. **Write the scenarios**: derive Given / When / Then test scenarios from the docs.
3. **Implement with TDD**: see Red → Green → Refactor.
4. **Check docs and code agree**: if the spec changed along the way, update the docs in the same change.

## Documentation

docs/ follows [Diátaxis](https://diataxis.fr/). Each page belongs to exactly one kind.

- `docs/tutorials/` guided, single-path lessons
- `docs/how-to/` task-oriented guides
- `docs/reference/` facts: specs, checks, formats
- `docs/explanation/` background and design decisions (decision records in `docs/explanation/decisions/`)

The index is `docs/README.md`.

## When to use each skill

| Skill | Use when |
|---|---|
| `docs` | Before any implementation (every time). Writing or updating docs/ or the README. Unsure which Diátaxis kind a page belongs to |
| `tdd` | Before writing or changing production code (every time). Fixing bugs, adding tests |
| `design` | Creating a new module or package. Unsure whether to split, abstract, or extract shared code. Planning a refactoring |
| `best-practices` | Writing or reviewing code. Adding a dependency. Configuring build, CI, or CSP. Using browser APIs such as File, DecompressionStream, DataView, or Web Crypto |
| `github-mcp` | Committing, pushing, branching, or opening PRs (this devcontainer has no git credentials) |

The usual order for a feature is `docs` → `design` (if needed) → `tdd` (with `best-practices`).

## Never

- Add code that sends, or could send, user file contents anywhere (analytics, CDNs, external fonts, telemetry, etc.).
- Widen the CSP allowlist without documenting the reason in docs/explanation.
- Write production code before the docs and scenarios.
- Commit real emails or personal data (`samples/private/` is ignored by git).
- Commit `.devcontainer/` (it is ignored by git).
