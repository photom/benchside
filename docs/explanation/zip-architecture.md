# ZIP analyzer architecture

Spec: [ZIP analyzer specification](../reference/zip/README.md). Decision: [0007](decisions/0007-zip-read-from-the-end.md).

## Modules

```mermaid
flowchart TD
  subgraph app ["apps/zip"]
    App[App.tsx] --> views[views/*]
    App --> host[worker/host.ts]
    host <-- postMessage --> worker[worker/worker.ts]
    worker --> chain["worker/chain.ts<br/>open file + nested chain"]
    App --> ui["@benchside/ui<br/>DropZone"]
  end
  subgraph pkg ["@benchside/zip — no DOM"]
    analyze[analyze.ts] --> endr[end-records.ts]
    analyze --> central[central.ts]
    analyze --> local[local.ts]
    analyze --> map[byte-map.ts]
    central & local --> fields[fields.ts]
    central & local --> extra[extra.ts]
    extra --> decode[extra-decode.ts]
    fields --> text[text.ts<br/>UTF-8, CP437]
    open[nested.ts] --> inflate[inflate.ts]
    open --> crc[crc32.ts]
    analyze & open --> source[source.ts<br/>ByteSource]
    analyze --> findings[findings.ts]
    analyze --> sec[security.ts]
    analyze --> rd[disagreement.ts]
    analyze & open --> params[parameters.ts]
  end
  chain --> analyze
  chain --> open
```

| Module | Does | Rules |
|---|---|---|
| `source.ts` | `ByteSource`, `blobSource`, `bytesSource`, cached window reader | — |
| `end-records.ts` | EOCD search, ZIP64 locator and record, effective values | EOCD-*, Z64-1..4, NUM-1 |
| `central.ts` | Central directory location, shift, headers | CD-* , Z64-5, Z64-7 |
| `local.ts` | Local headers, comparison, file data, descriptors | LH-*, Z64-6 |
| `byte-map.ts` | Regions, gaps, overlaps | MAP-* |
| `fields.ts` | Versions, flags, methods, DOS time, attributes | FLD-* |
| `extra.ts` | Extra field blocks, names, ZIP64 and Unicode Path decoding | EXT-1..4, EXT-10, NAME-2 |
| `extra-decode.ts` | Timestamps, UNIX owner, NTFS times, AES, Android alignment | EXT-5..9, EXT-11 |
| `text.ts` | UTF-8 and Code Page 437 decoding | NAME-1, NAME-3, NAME-4 |
| `crc32.ts` | CRC-32 | EXT-4 |
| `inflate.ts` | Bounded raw-deflate decompression | NEST-3 |
| `nested.ts` | Refusal reasons, content, verification | NEST-* |
| `findings.ts` | Finding collector with the 1 000 limit; severity, category, and section per ID | REP-7, REP-8, REP-10 |
| `parameters.ts` | Defaults, ranges, clamping | PAR-* |
| `security.ts` | Name, size, count, and overlap checks over the finished entries and byte map | SEC-* |
| `disagreement.ts` | EOCD candidates, name encodings, bounded scan of gaps for hidden headers | RD-1, RD-3..5 |

## Analysis flow

```mermaid
sequenceDiagram
  participant UI as App
  participant W as Worker
  participant P as zip package
  UI->>W: analyze(file)
  W->>P: analyzeZip(blobSource(file))
  P->>P: read last 64 KiB, find EOCD
  P->>P: read central directory in windows
  P->>P: read each local header
  P-->>W: ZipReport
  W-->>UI: report, path []
  UI->>W: open(path [3])
  W->>P: openNested(source, entry 3, depth 1)
  P-->>W: report or refused
  W-->>UI: result
```

## Worker protocol

| Direction | Message |
|---|---|
| UI → worker | `{ type: 'analyze', id, file: Blob, parameters }` |
| UI → worker | `{ type: 'open', id, path: number[] }` |
| worker → UI | `{ type: 'report', id, report }` |
| worker → UI | `{ type: 'refused', id, reason }` |
| worker → UI | `{ type: 'failed', id, message }` |

- A `File` is passed by reference; it is not copied into memory.
- The host keeps only the latest request's answer, like the mail app's host. A worker error rejects the waiting request.
- `parameters` is the user's partial set; the package fills in defaults and clamps (PAR-11). Nested archives reuse the top-level report's values (PAR-13), so `open` carries none.
- `ArchiveChain` (`worker/chain.ts`) caches `{ source, report }` per path. Opening a path drops cached entries that are not on it, and only the latest open fills the cache. A new file drops them all.

## UI

```mermaid
flowchart TD
  h[Heading] --> drop[DropZone]
  drop --> options["Options<br/>limits, thresholds,<br/>target file system, checks"]
  options --> crumbs["Path: outer.zip › inner.zip"]
  crumbs --> summary["Summary<br/>size, entries, ZIP64, shift, comment"]
  summary --> findings[Findings]
  findings --> entries["Entries table<br/>select one"]
  entries --> detail["Entry detail<br/>central vs local, extra fields,<br/>data, descriptor, Open as archive"]
  detail --> map["Byte map table"]
  map --> refs[References]
```

| Rule | Why |
|---|---|
| Tables show 500 rows, then a "Show more" button | 100 000 entries would make the page slow; paging is simpler than virtual scrolling and keeps keyboard order |
| Mismatched fields carry the text "differs", not only a color | Distinctions must not rely on color alone |
| Offsets show decimal and hex | APPNOTE and hex editors use hex; sizes are easier in decimal |
| Findings show their APPNOTE section | REQ-ZIP-002: users can check the rule |
| Names and comments render as text | They come from the file |
| "Open as archive" shows the refusal reason inline | The user sees why nothing opened |
| The archive hint reads "archive?" next to the name | Marks likely archives without color |
| Findings are grouped under Security, Reader disagreement, and Structure, each with a count | The category answers "should I worry?" before the details |
| Options live in component state only | REQ-ZIP-008: values last for the visit; nothing is stored |
| A number input applies on change (blur or Enter), not on every keystroke | Typing "1000" must not analyze with 1, 10, and 100 first |

## Shared UI

The drop zone moves from the mail app into `@benchside/ui` (the second app needs it). It keeps the class `drop` and its layout rule ([mail UI](mail-design/ui.md)).

## Changing an option

```mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant W as Worker
  U->>A: change a parameter
  A->>W: analyze(file, parameters)
  W-->>A: report (parameters recorded)
  loop each nested archive that was open, outermost first
    A->>W: open(its path)
    W-->>A: report, or refused
    Note over A: refused: stop, show the levels opened so far, and say why
  end
```

A change re-reads the headers and decompresses the open nested archives again, even when only a security check was toggled. That keeps one code path and always matches the spec. If it proves slow on very large archives, the security checks can run again on the cached report instead.
