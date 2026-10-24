# 0001: Tech stack

## Context

benchside is a set of browser-only tools that parse untrusted binary and text formats (MIME, ZIP, PDF). It is hosted as static files on GitHub Pages, and must never send file contents anywhere.

## Decision

- **TypeScript** for all code. Binary parsing bugs are mostly mixed-up offsets and field widths; types help catch them.
- **Parsers as DOM-independent packages** (`packages/zip`, `packages/pdf`, `packages/mail`). They take bytes and return plain data (a structure tree plus diagnostics), so they can be tested in Node.
- **Vite** with a multi-page build: one HTML entry and bundle per tool. (Superseded by [0002](0002-one-app-per-tool.md): one Vite app per tool.)
- **Preact** for the UI: React-compatible API with a small footprint.
- **vitest** for tests, run in Node for parsers.
- **Minimal runtime dependencies.** Parsers are written in-house; the browser provides decompression (`DecompressionStream`) and cryptography (Web Crypto).

## Consequences

- Parsers can be fuzzed with large sets of malformed files without a browser.
- Writing parsers ourselves costs more up front, but gives full control over how tolerant they are of broken input, and reduces supply-chain risk.
- GitHub Pages cannot set response headers, so the Content Security Policy is delivered as a `<meta>` tag (see [Privacy model](../privacy-model.md)).
