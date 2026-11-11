# 0013: DMARC aggregate reports get their own app and package

## Context

- REQ-DMARC-001 to 011 ask for a tool that reads batches of DMARC aggregate reports.
- The mail app analyzes one message. Its input, UI, and state are different: one file, one result, no batch.
- Reports come as XML, gzip, ZIP, or tar, and users keep them in folders. `@benchside/zip` already reads ZIP files within limits. `@benchside/core` has bounded inflate for `deflate` and `deflate-raw`.
- The optional reverse lookup (REQ-DMARC-008) needs the DoH endpoints. Every other part needs no network.
- The other apps send one file to the worker and get one report back. A batch keeps growing as the user adds files, and filters change often.

## Decision

```mermaid
flowchart LR
  app["apps/dmarc-aggregate<br/>/benchside/dmarc-aggregate/"] --> pkg["@benchside/dmarc-aggregate<br/>no DOM"]
  app --> dns["@benchside/dns<br/>0014"]
  app --> ui["@benchside/ui"]
  pkg --> zip["@benchside/zip<br/>ZIP entries"]
  pkg --> core["@benchside/core<br/>inflate: gzip added"]
  pkg --> dns
  zip --> core
```

- A new app, `apps/dmarc-aggregate`, deployed to `/benchside/dmarc-aggregate/`, and a new package, `@benchside/dmarc-aggregate`.
- The package reads ZIP files through `@benchside/zip` (`analyzeZip` and its entry data).
- `inflate` in `@benchside/core` gains the `'gzip'` format. It stays free of report knowledge.
- The worker holds the batch. The UI sends files, filters, and lookup settings. The worker answers with snapshots: a `Batch` summary, a `View` for the current filters, and progress ([Report](../../reference/dmarc-aggregate/report.md), [Progress](../../reference/dmarc-aggregate/progress.md)). Records never cross to the main thread in bulk.
- The worker reads in short steps and sends a snapshot every 250 ms, so results show while a large batch is read (REQ-DMARC-010). Reverse lookups report in batches the same way.
- Folders are walked on the main thread. `DropZone` in `@benchside/ui` gains folder drops and a folder picker; the other apps keep their single-file use.
- CSP: `connect-src https://cloudflare-dns.com https://dns.google`, the same as the mail app. Reason: the opt-in reverse lookup of REQ-DMARC-008. With lookup off, the app makes no requests. The policy blocks every other host, including from the worker.
- Charts are SVG drawn by Preact components in the app. No chart library.

## Consequences

- The CSP allowlist grows by one app. [Privacy model](../privacy-model.md) and [Architecture](../architecture.md) list it.
- A stateful worker is new in this repository. "Clear" replaces the worker's state and starts a new generation; the UI drops messages from older generations and lookup sessions (PRG-13).
- Each filter change costs one pass over the records in the worker. The implementation must measure this at the 1 000 000-record limit. The UI keeps the previous view until the new one arrives.
- Charts written in-house must keep to the CSP rules: no string `style` attributes; colors come from CSS classes.
- A snapshot recomputes the `View` from all counted reports. If that grows too slow on large batches, the view can be updated incrementally later; the protocol does not change.
- RFC 1952 allows several members in one gzip file (INP-4). Step 2 of the build order must check that `DecompressionStream('gzip')` reads past the first member in Chromium and Node. If one stops after the first member, or fails on the bytes after it, step 2 chooses a fallback and records it here. Splitting members needs the end of each deflate stream, which `DecompressionStream` does not report, so the fallback is not obvious.
