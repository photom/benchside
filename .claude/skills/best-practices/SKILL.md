---
name: best-practices
description: Best practices for benchside's stack (TypeScript / Vite / Preact / vitest / browser APIs / GitHub Pages) and for binary parsing and security. Use when writing or reviewing code, adding a dependency, configuring the build, CI, or CSP, and when using browser APIs such as File, DecompressionStream, DataView, or Web Crypto.
---

# Best practices

When in doubt, follow the official documentation of each product. This page covers what matters most in this repository and where we deliberately deviate from the defaults.

## Privacy (top priority)

- Never send user file contents anywhere. Do not add `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or external images or fonts. No analytics, no CDNs.
- The only outbound traffic is DoH (domain names only), and users can turn it off.
- Every app has a CSP, injected into `index.html` at build time by our Vite plugin (not in dev mode, where Vite uses inline styles). Give each app the least it needs: `connect-src 'none'` by default; only the mail app allows `https://cloudflare-dns.com https://dns.google`. A test checks every built `index.html` for the expected policy.
  ```html
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; connect-src 'none'; worker-src blob:; img-src 'self' blob: data:; object-src 'none'">
  ```
- Any change that widens an app's CSP needs a rationale in docs/explanation, and the README and privacy model must be updated to match.
- Do not persist file contents in `localStorage` or similar.

## Dependencies

- Keep runtime dependencies to a minimum. Write parsers (ZIP / PDF / MIME / DKIM, etc.) in-house. Use Web Crypto (`crypto.subtle`) for cryptography and `DecompressionStream` for decompression.
- Before adding a dependency, check whether a standard API or a few dozen lines of our own code would do. If you add one, state why in the commit message.
- Commit `package-lock.json`; CI uses `npm ci`. Versions are pinned by the lockfile.

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any` (accept `unknown` at boundaries and narrow it).
- ESM only. Enable `verbatimModuleSyntax` and use `import type` for types.
- Represent structures and diagnostics as discriminated unions (a `kind` field) and check exhaustiveness in `switch` with `never`.
- Exceptions are for programming bugs; anomalies in input are returned as diagnostics.
- Make units explicit in names for offsets and lengths (`offset`, `byteLength`). Use branded types where it helps.

## Binary parsing

- Never trust input. Bounds-check every read; out-of-range reads become diagnostics, then continue or stop.
- Don't allocate huge buffers based on length or count fields. Cap them by file size or a limit.
- Loops and recursion (PDF `/Prev`, ObjStm, nested ZIPs, nested MIME) get a visited set and a depth limit.
- Decompression has an output size limit; read as a stream and abort when exceeded (zip bomb defense).
- Read 64-bit values with `getBigUint64` and report a diagnostic if they exceed `Number.MAX_SAFE_INTEGER`.
- For large files, read only the needed ranges with `File.slice()`. Run heavy parsing in a Web Worker so the UI stays responsive.
- Decode text with `TextDecoder`; when the encoding was guessed, say so in the result.

## UI (Preact)

- Function components and hooks. Keep state in the smallest scope that needs it.
- Always render strings from files as text. Never use `dangerouslySetInnerHTML`. Never execute or render HTML from files or JavaScript from PDFs.
- Style with CSS files or Preact object styles (`style={{ color: 'red' }}`). Never string `style` attributes or `<style>` in markup; the CSP blocks them in production.
- Use virtual scrolling for long lists (hex dumps, object lists).
- Accessibility: keyboard operation, distinctions that don't rely on color alone (add labels or patterns), proper landmarks and labels.
- Accept files both by drag and drop and via `<input type="file">`.

## Vite / build / CI

- One Vite app per tool under `apps/`, linked by npm workspaces. Each app's `vite.config.ts` stays short; shared settings (`base` = `/benchside/<tool>/`, the CSP plugin) come from one helper.
- Packages are consumed as TypeScript source through workspaces; no separate build step for packages unless needed.
- Start workers only with Vite's `?worker&inline` import, so they run from a `blob:` URL and inherit the page's CSP. A worker loaded from a plain URL gets no CSP on GitHub Pages ([0004](../../../docs/explanation/decisions/0004-worker-from-blob-url.md)).
- No inline scripts, so the CSP never has to be loosened.
- CI (GitHub Actions): `npm ci` → type check (`tsc --noEmit`) → lint → `vitest run` → build all apps → collect each `apps/*/dist` into one directory → deploy to Pages. Pin actions by commit SHA and keep `permissions` minimal.
- Publishing source maps is fine (the code is public anyway).

## Code conventions

- Leave formatting and linting to the tools (follow the Prettier / ESLint config; don't debate by hand).
- Comments explain why. Cite the source for spec-derived values (e.g. `// APPNOTE 4.3.16`).
- Small commits, one purpose per commit.
