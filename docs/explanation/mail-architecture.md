# Mail analyzer architecture

- Why: [requirements](requirements/)
- What exactly: [specification](../reference/mail/)
- Repository-wide view: [Architecture](architecture.md)

## Context

```mermaid
flowchart LR
  user([User]) -- ".eml / pasted source" --> app
  subgraph browser [Browser tab — CSP enforced]
    app[apps/mail<br/>Preact UI] <-- postMessage --> worker[Worker<br/>@benchside/mail]
  end
  worker -- "names + types only;<br/>sensitive names blocked by default" --> doh[(DoH provider)]
  app -. "nothing" .-x net[(Any other host)]
  worker -. "nothing" .-x net
```

- The message never leaves the tab.
- The worker starts from a `blob:` URL, so it inherits the page's CSP ([0004](decisions/0004-worker-from-blob-url.md)).

## Packages and modules

```mermaid
flowchart TD
  subgraph apps/mail
    views[views/*<br/>Preact]
    host[worker-host.ts<br/>request IDs, cancel]
    entry[worker.ts<br/>worker entry]
    doh[doh.ts<br/>DoH transport]
  end

  subgraph "@benchside/mail"
    analyze[analyze.ts<br/>orchestrator, deadline]
    message[message/<br/>headers, MIME, line endings]
    envelope[envelope/<br/>Received parser, boundary]
    dns[dns/<br/>budget → policy → cache → log]
    spf[spf/]
    dkim[dkim/]
    dkim2[dkim2/]
    dmarc[dmarc/]
    arc[arc/]
    authres[authres/]
    psl[psl/<br/>snapshot + lookup]
    shared[shared/<br/>tag-list, canonicalization,<br/>crypto, findings, trace]
    report[report/<br/>summary, export]
  end

  views --> host --> entry
  entry --> analyze
  entry --> doh
  doh -. "transport for" .-> dns

  analyze --> message & envelope & spf & dkim & dkim2 & arc & dmarc & authres & report
  spf & dkim & dkim2 & arc & dmarc --> dns
  dkim & dkim2 & arc --> shared
  dmarc --> psl
  envelope & authres --> message
```

| Rule | Why |
|---|---|
| Only `doh.ts` calls `fetch` | Network stays at the edge |
| Every DNS query passes budget, policy, cache, and log | Limits and privacy apply in one place ([DNS spec](../reference/mail/dns.md#layers)) |
| `@benchside/mail` has no DOM and no Preact | Runs in Node for tests |
| Checks never call each other; only `analyze.ts` combines them | Each check is testable alone |
| `shared/` holds only code used by 2+ checks | DKIM, DKIM2, and ARC share tag lists, canonicalization, and crypto |
| Nothing goes to `@benchside/core` yet | No second package exists |

## Analysis pipeline

```mermaid
flowchart LR
  bytes[/Uint8Array/] --> parse[message.parse]
  parse --> msg[(Message)]
  msg --> env[envelope.infer]
  overrides[/user overrides/] --> env
  env --> ctx[(Context:<br/>delivery details,<br/>reference time,<br/>resolver, signal)]

  msg & ctx --> spf[spf.evaluate]
  msg & ctx --> dkim[dkim.verifyAll]
  msg & ctx --> dkim2[dkim2.verify]
  msg & ctx --> arc[arc.validate]
  msg --> ar[authres.parse]

  spf & dkim --> dmarc[dmarc.evaluate]
  msg --> dmarc

  spf & dkim & dkim2 & arc & dmarc --> cmp[authres.compare]
  ar --> cmp
  cmp & spf & dkim & dkim2 & arc & dmarc --> rep[report.build]
```

- SPF, DKIM, DKIM2, and ARC run in parallel. DMARC waits for SPF and DKIM.
- A missing input gives `not-evaluated`, never an exception.

## Interaction and cancellation

```mermaid
sequenceDiagram
  actor U as User
  participant UI as UI (main thread)
  participant H as worker-host
  participant W as Worker
  participant R as dns/ + doh.ts

  U->>UI: drop .eml
  UI->>H: analyze(bytes, options)
  H->>W: {id: 1, bytes, options}
  W->>W: parse, infer envelope
  W-->>H: {id: 1, progress: envelope}
  par checks
    W->>R: query(name, type, signal)
    R-->>W: DnsAnswer
  end
  U->>UI: edit delivery details
  UI->>H: analyze(bytes, options')
  H->>W: {cancel: 1}
  W->>W: abort signal 1
  H->>W: {id: 2, bytes, options'}
  W-->>H: {id: 2, report}
  H-->>UI: report (id 1 results are dropped)
```

| Rule |
|---|
| Each request has an ID. The host drops responses whose ID is not the latest |
| Each analysis has an `AbortController`. Its signal reaches every check and every DNS query |
| Cancel aborts in-flight `fetch` calls; the session cache keeps answers already received |

## Limits

```mermaid
flowchart LR
  a[Analysis] --> d[Deadline 60 s<br/>analyze.ts]
  a --> b[DNS budget 200<br/>dns/]
  a --> l[Per-method limits<br/>SPF 10 lookups, DKIM 20 sigs,<br/>ARC 50 sets, MIME depth 32]
```

- Values and behavior: [spec limits](../reference/mail/README.md#limits).
- The deadline aborts the same signal as a cancel. Unfinished methods become `not-evaluated` (reason `timeout`).

## Data model

Defined in the [Report spec](../reference/mail/report.md#data-model). Design rules:

| Rule | Why |
|---|---|
| Plain data only (no classes, no functions) | Crosses `postMessage`; serializes to JSON |
| Evidence holds offsets into the original bytes | The UI highlights the source without copies |
| Finding IDs are the names in the spec | Tests, docs, and UI use one vocabulary |

## Testing

```mermaid
flowchart LR
  spec[Spec rule IDs] --> scen[Scenarios<br/>it.todo]
  req[REQ acceptance criteria] --> acc[Acceptance tests]
  scen --> unit[Unit tests per check<br/>Node, fake Resolver]
  keys[Keys generated in tests<br/>Web Crypto] --> fix[Signed fixtures<br/>built in code]
  fix --> unit
  vec[RFC test vectors] --> unit
  acc --> browser[Browser tests<br/>CSP, offline mode]
```
