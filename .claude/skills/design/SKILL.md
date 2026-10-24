---
name: design
description: Design guidelines for benchside. Use DDD, Clean Architecture, SOLID, and DRY as tools, not dogma. Use when creating a new module or package, deciding how to split files, types, or functions, when unsure whether to add an abstraction or extract shared code, and when planning a refactoring.
---

# Design (don't be dogmatic about principles)

DDD, Clean Architecture, SOLID, and DRY are **tools for solving problems**, not a checklist to satisfy. This repository is a collection of small tools, so favor lightness and readability.

## Boundaries we keep (these are firm)

- **Parsers and analysis logic are pure, DOM-independent TypeScript.** Input is bytes (`Uint8Array` or a read function); output is plain data (a structure tree plus diagnostics). Never import `window`, `document`, or a UI framework.
- **The UI only displays parser results.** No analysis logic in the UI.
- **Network access stays at the edge.** DoH lookups are passed in as an injectable function; parsers and checks never call `fetch` directly. This keeps them testable and makes it easy to keep the CSP allowlist in sync.

Add further layers only when they become necessary.

## How to use each principle

- **DDD**: adopt the ubiquitous language. Name types, functions, and diagnostics after the terms in the specs (APPNOTE, ISO 32000, RFCs) and use the same words as docs/reference. Tactical patterns (entities, aggregates, repositories) are generally unnecessary.
- **Clean Architecture**: the three boundaries above are enough. Don't create use-case layers or interface-only files for form's sake.
- **SOLID**: apply single responsibility as "separate things that change for different reasons". Introduce an interface only when there are two or more implementations, or a test needs to substitute one.
- **DRY**: remove duplicated knowledge (specs, constants, decision rules). For code that merely looks similar, wait for the third occurrence (Rule of Three). Don't force shared code between ZIP and PDF just because something happens to look alike.
- **YAGNI**: don't abstract for "we might handle OGG later". Extract when the second real user appears.

## When in doubt

1. Is it easy to test (verifiable through inputs and outputs alone)?
2. Can a reader understand it from one file? If indirection grows, question the cost of the abstraction.
3. Does it tolerate broken input? Avoid designs whose strict types can only represent a "valid ZIP"; anomalies must be representable as diagnostics.
4. Does it avoid adding runtime dependencies?

## Suggested layout

```
packages/
  core/   # byte reader (thin DataView wrapper), ranges, diagnostic types — only what multiple parsers actually share
  zip/    # ZIP parser and checks
  pdf/    # PDF parser and checks
  mail/   # MIME and authentication
apps/web/ # Vite multi-page UI (one entry per tool)
```

Move something into `core` only once two or more packages use it. Until then, keep it inside the package.

Record design decisions that remain debatable in docs/explanation/decisions/ (see the `docs` skill).
