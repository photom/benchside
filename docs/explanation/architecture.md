# Architecture

Repository-wide view. Per-tool details:

- [Mail analyzer architecture](mail-architecture.md)
- [ZIP analyzer architecture](zip-architecture.md)
- [PDF analyzer architecture](pdf-architecture.md)

Decisions: [0002](decisions/0002-one-app-per-tool.md) (one app per tool), [0010](decisions/0010-shared-core-package.md) (shared core package), [0004](decisions/0004-worker-from-blob-url.md) (workers from `blob:` URLs), [0005](decisions/0005-shared-vite-config-and-browser-tests.md) (shared Vite config, browser tests).

## Repository

```mermaid
flowchart TD
  subgraph apps [apps/ — one Vite + Preact app each]
    home[home]
    mail[mail]
    zip[zip]
    pdf[pdf]
  end

  subgraph packages [packages/ — @benchside/*]
    pmail[mail<br/>no DOM]
    pzip[zip<br/>no DOM]
    ppdf[pdf<br/>no DOM]
    core[core<br/>no DOM<br/>byte reading, inflate]
    ui[ui<br/>Preact<br/><i>when 2+ apps share</i>]
  end

  shared[vite.shared.ts<br/>base path, CSP plugin]

  mail --> pmail
  zip --> pzip
  pdf --> ppdf
  pzip & ppdf --> core
  mail & zip & pdf & home -.-> ui
  mail & zip & pdf & home --> shared
```

| Rule |
|---|
| Apps never import from other apps |
| Packages never import Preact or the DOM, except `ui` |
| Dashed arrows: created only when a second user appears |
| `vite.shared.ts` is build-time only; it never ships to the browser |

## Inside one tool

Every tool follows the same shape.

```mermaid
flowchart LR
  subgraph tab [Browser tab — CSP from meta tag]
    subgraph main [Main thread]
      view[Preact views] --> host[worker host]
    end
    subgraph worker [Worker — blob: URL, inherits CSP]
      entry[worker entry] --> pkg["@benchside/&lt;tool&gt;<br/>pure parse + checks"]
      entry --> edge[edge adapters<br/>e.g. DoH resolver]
      pkg -. injected .-> edge
    end
    host <-- "postMessage<br/>(plain data)" --> entry
  end
  file[/File/] --> view
  edge --> net[(Allowed hosts only)]
```

| Layer | Knows about | Tested with |
|---|---|---|
| Package | Bytes in, plain data out | vitest, Node |
| Edge adapters | `fetch`, File API | vitest with fakes |
| Worker host / entry | `postMessage` | vitest |
| Views | Preact, DOM | vitest + happy-dom |
| Whole page | CSP, real browser | vitest browser mode |

| CSP-driven UI rule | Why |
|---|---|
| No inline `<script>` | `script-src` falls back to `'self'` |
| Styles via CSS files or Preact object styles only; never string `style` attributes | `style-src` falls back to `'self'`; string attributes are blocked, CSSOM property writes are not |

## Network policy per app

```mermaid
flowchart LR
  home[home] --x net[(Network)]
  zip[zip] --x net
  pdf[pdf] --x net
  mail[mail] --> doh[(cloudflare-dns.com<br/>dns.google)]
```

| App | `connect-src` |
|---|---|
| home, zip, pdf | `'none'` |
| mail | `https://cloudflare-dns.com https://dns.google` |

All apps also use `default-src 'self'; worker-src blob:; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'`. Built by `vite.shared.ts` ([detailed design §10](mail-detailed-design.md#10-build-vitesharedts)).

## Build and deploy

```mermaid
flowchart LR
  pr[Pull request] --> ci
  push[Push to main] --> ci
  subgraph ci [GitHub Actions — actions pinned by SHA]
    install[npm ci] --> types[tsc --noEmit] --> lint[lint] --> test[vitest run] --> build[build each app]
    build --> csp[check CSP in<br/>every index.html]
    csp --> collect[collect apps/*/dist<br/>into site/]
  end
  collect -- "main only" --> pages[(GitHub Pages)]
  cron[Weekly schedule] --> psl[Update Public<br/>Suffix List] --> pr2[Pull request]
```

## URLs

```mermaid
flowchart TD
  root["/benchside/"] --> h[home]
  root --> m["/benchside/mail/"]
  root --> z["/benchside/zip/"]
  root --> p["/benchside/pdf/"]
```

## Tests

```mermaid
flowchart BT
  unit["Unit — packages<br/>Node, most tests"] --> comp["Component — views<br/>happy-dom"]
  comp --> browser["Browser — whole page<br/>CSP blocks other hosts,<br/>including from the worker"]
```

- Most tests are unit tests on packages.
- Browser tests are few and focus on things only a real browser can show.
