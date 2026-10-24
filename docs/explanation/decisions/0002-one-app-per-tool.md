# 0002: One app per tool

## Context

benchside will contain several tools (mail, ZIP, PDF, and more). [0001](0001-tech-stack.md) planned a single Vite multi-page build. But the tools need different privileges: only the mail tool needs network access (DNS-over-HTTPS), while the ZIP and PDF tools need none. A single build tends to share one Content Security Policy and one set of dependencies across all pages.

We also considered whether Vite is the right build tool at all. The alternatives were esbuild alone, or no bundler (`tsc` and native ES modules).

## Decision

- **Each tool is its own Vite + Preact app** under `apps/`, deployed to its own path on GitHub Pages (`/benchside/<tool>/`). A small `apps/home` app lists the tools.
- **Parsers and shared code are packages** under `packages/` (`@benchside/mail`, `@benchside/zip`, `@benchside/pdf`, and later `@benchside/core` and `@benchside/ui`).
- **npm workspaces** tie them together (`"workspaces": ["apps/*", "packages/*"]`). Strict TypeScript settings live in `tsconfig.base.json`, and a root vitest config runs every package's tests.
- **Each app has its own CSP.** Apps that do not need the network use `connect-src 'none'`. Only the mail app allows the DoH endpoints.
- **The CSP `<meta>` tag is injected at build time by a small Vite plugin.** In dev mode Vite injects CSS as inline `<style>` tags, which the CSP would block. A test checks that every built `index.html` contains the expected policy.
- **Vite stays as the build tool.** vitest already depends on Vite, so dropping it would not shrink the toolchain unless we also replaced vitest. Vite handles multiple apps, Web Workers, and Preact with little configuration. The parsers are plain TypeScript, so switching build tools later would be cheap.

Rules:

- Apps never import from other apps. If one app needs another's UI (for example, the mail app showing a ZIP attachment), move that UI into a package at that point.
- Packages never import Preact or touch the DOM, except `@benchside/ui`.
- Create a package or app only when work on it starts. Don't commit empty skeletons.

## Consequences

- Each tool gets the least network privilege it needs, enforced by the browser.
- Adding or removing a tool does not affect the others.
- Each app has a short `vite.config.ts`. Shared settings (base path, CSP plugin) come from one helper so they are not copied.
- Deployment needs a script that collects each `apps/*/dist` into one directory for GitHub Pages.
- The build-time dependency tree stays large (Vite and its plugins). If that becomes a concern, the alternative is esbuild plus Node's built-in test runner, at the cost of maintaining our own build scripts.

This supersedes the "Vite with a multi-page build" part of [0001](0001-tech-stack.md).
