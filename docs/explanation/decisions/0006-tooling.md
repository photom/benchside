# 0006: Tooling

## Context

```mermaid
flowchart LR
  need[Need: type check, lint, format,<br/>test, build, docs check] --> pick{Few dev dependencies}
```

- Build-time dependencies can inject code into the bundle. Fewer is safer ([best practices](../../../.claude/skills/best-practices/SKILL.md)).
- Diagrams must parse on GitHub; this broke once already.

## Decision

| Concern | Tool | Rejected |
|---|---|---|
| Lint + format | Biome (one binary) | ESLint + Prettier + typescript-eslint: many packages |
| Type check | TypeScript 7 `tsc --noEmit` | — |
| JSX for Preact | Vite's built-in transform with `jsxImportSource: "preact"` | `@preact/preset-vite`: pulls in Babel |
| Tests | vitest 5: projects `unit` (Node), `dom` (happy-dom), `browser` (Playwright, Chromium) | — |
| Diagram check | `scripts/check-mermaid.mjs` (mermaid + jsdom, dev only) | Rendering with mermaid-cli: needs Puppeteer |
| Node | 24 or later (`engines`); CI uses 26 | — |
| Package manager | npm workspaces, `npm ci` | pnpm: extra tool |

CI actions are pinned by commit SHA:

| Action | Version | SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/cache` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-pages-artifact` | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| `actions/deploy-pages` | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` |

## Consequences

- No Preact fast refresh in dev (preset-only). Full reload is acceptable for small apps.
- Without the preset, Preact DevTools integration needs a manual `import 'preact/debug'` in dev.
- mermaid and jsdom add many transitive dev dependencies, but none reach the bundle.
