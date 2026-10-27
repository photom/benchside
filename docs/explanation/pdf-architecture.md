# PDF analyzer architecture

Spec: [PDF analyzer specification](../reference/pdf/README.md). Decisions: [0009](decisions/0009-pdf-read-from-the-end.md), [0010](decisions/0010-shared-core-package.md).

## Modules

```mermaid
flowchart TD
  subgraph app ["apps/pdf"]
    App[App.tsx] --> views[views/*]
    App --> host[worker/host.ts]
    host <-- postMessage --> worker[worker/worker.ts]
    App --> ui["@benchside/ui<br/>DropZone"]
  end
  subgraph pkg ["@benchside/pdf — no DOM"]
    analyze[analyze.ts] --> header[header.ts]
    analyze --> tail[tail.ts]
    analyze --> revs[revisions.ts]
    revs --> table[xref-table.ts]
    revs --> xstream[xref-stream.ts]
    xstream --> predictor[predictor.ts]
    analyze --> objects[objects.ts]
    table & xstream & objects --> parser[parser.ts]
    parser --> lexer[lexer.ts]
    analyze --> map[byte-map.ts]
    analyze --> findings[findings.ts]
  end
  subgraph core ["@benchside/core — no DOM"]
    source[source.ts<br/>ByteSource, Reader]
    inflate[inflate.ts<br/>bounded]
  end
  worker --> analyze
  pkg --> core
```

| Module | Does | Rules |
|---|---|---|
| `lexer.ts` | Tokens from a byte window: white space, comments, delimiters, numbers, strings, names, keywords | LEX-*, OBJ-2..5 |
| `parser.ts` | Objects from tokens: arrays, dictionaries, references, indirect objects, stream extents | OBJ-*, IND-* |
| `header.ts` | `%PDF-` header, version, binary marker | HDR-* |
| `tail.ts` | `startxref`, offset, `%%EOF`, trailing bytes | EOF-* |
| `xref-table.ts` | Table sections and their trailers | XREF-2..5, TRL-* |
| `xref-stream.ts` | Cross-reference stream dictionary and entries | XST-1, XST-2, XST-4, XST-5 |
| `predictor.ts` | PNG predictors | XST-3 |
| `revisions.ts` | Section chain through `XRefStm` and `Prev`, loop guard, merge | XREF-1, REV-* |
| `objects.ts` | Reads each object at its offset; type, subtype, stream extent | OBX-* |
| `byte-map.ts` | Regions, gaps, overlaps | MAP-* |
| `findings.ts` | Finding collector with the 1 000 limit; severity and clause per ID | REP-6, REP-7 |

## Worker protocol

| Direction | Message |
|---|---|
| UI → worker | `{ type: 'analyze', id, file: Blob }` |
| worker → UI | `{ type: 'report', id, report }` |
| worker → UI | `{ type: 'failed', id, message }` |

- A `File` is passed by reference; it is not copied into memory.
- The host keeps only the latest request's answer, like the other apps.

## UI

```mermaid
flowchart TD
  h[Heading] --> drop[DropZone]
  drop --> summary["Summary<br/>version, size, revisions, objects, encrypted"]
  summary --> findings[Findings]
  findings --> revs["Revisions<br/>newest first"]
  revs --> objs["Objects table<br/>500 rows per page"]
  objs --> map["Byte map table"]
  map --> refs[References]
```

| Rule | Why |
|---|---|
| Tables show 500 rows, then "Show more" | Large files have hundreds of thousands of objects |
| Offsets show decimal and hex | Hex editors use hex; sizes read better in decimal |
| Findings show their ISO 32000-1 clause | REQ-PDF-002: users can check the rule |
| Names and strings from the file render as text | They come from the file |
| Replaced objects say "replaced in revision n", not only a color | Distinctions must not rely on color alone |
