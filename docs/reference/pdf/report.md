# Report

The output of `@benchside/pdf`: plain data, no DOM, safe to pass to the UI with `postMessage`.

## Data model

```mermaid
classDiagram
  class PdfReport {
    byteLength number
    header Header or null
    revisions Revision[]
    objects PdfObject[]
    trailer Trailer or null
    encrypted boolean
    regions Region[]
    document Document or null
    actions Action[]
    findings Finding[]
  }
  class Header {
    offset number
    version string
    binaryMarker boolean
  }
  class Revision {
    index number
    offset number
    kind table or stream
    trailer Trailer
    xrefStm number or null
    entryCount number
  }
  class Trailer {
    size number or null
    prev number or null
    root Ref or null
    info Ref or null
    encrypt boolean
    id string[] or null
  }
  class PdfObject {
    number number
    generation number
    status in-use, compressed, or free
    revision number
    replaced number[]
    offset number or undefined
    container number or undefined
    index number or undefined
    type string or undefined
    subtype string or undefined
    stream Stream or undefined
  }
  class Region {
    kind RegionKind
    offset number
    byteLength number
    object number or undefined
  }
  class Finding {
    id string
    severity error, warning, info
    message string
    clause string or undefined
    offset number or undefined
    object number or undefined
  }
  PdfReport --> Header
  PdfReport --> Revision
  PdfReport --> PdfObject
  PdfReport --> Region
  PdfReport --> Finding
  Revision --> Trailer
```

```mermaid
classDiagram
  class Document {
    catalog Catalog or null
    info Info or null
    pageCount number or null
    pages Page[]
    outlineItems number
    fields number
  }
  class Catalog {
    object number or null
    version string or null
    pageLayout string or null
    pageMode string or null
    lang Text or null
    keys string[]
  }
  class Info {
    object number or null
    entries InfoEntry[]
  }
  class InfoEntry {
    key string
    kind text, name, or other
    value Text
  }
  class Text {
    text string or null
    truncated boolean
  }
  class Page {
    index number
    object number or null
    mediaBox number[] or null
    cropBox number[] or null
    rotate number
    annotations Annotation[]
  }
  class Annotation {
    object number or null
    subtype string or null
  }
  class Action {
    type string
    source catalog, names, page, annotation, field, or outline
    event string
    automatic boolean
    depth number
    page number or undefined
    holder number or undefined
    object number or undefined
    label string or undefined
    target Text or undefined
    script Script or undefined
  }
  class Script {
    text Text
    byteLength number
  }
  Document --> Catalog
  Document --> Info
  Info --> InfoEntry
  Document --> Page
  Page --> Annotation
  Action --> Script
```

| ID | Rule |
|---|---|
| REP-1 | `revisions` are listed newest first. `index` 0 is the oldest (REV-1). |
| REP-2 | `trailer` is the newest trailer (TRL-2), or null when no section was read. `id` holds the two `ID` strings in hex. |
| REP-3 | `objects` are sorted by number. A free object is listed when the winning entry (REV-4) is free; object 0 is not listed. `replaced` lists the older revisions that also defined the object (REV-4). |
| REP-4 | `offset` is set for objects in use, `container` and `index` for compressed objects (OBX-3). `stream` has `dataOffset`, `byteLength`, and `filters` (OBX-2). |
| REP-5 | Regions are sorted by offset (MAP-1). Kinds: `header`, `object`, `xref-stream`, `xref-table`, `trailer`, `startxref`, `prepended`, `trailing`, `gap`, `unknown`. |
| REP-6 | A finding's `clause` is the ISO 32000-1 clause behind it, when there is one. `offset` points at the bytes it is about; `object` at the object number. |
| REP-7 | Findings keep the order they were found in. After 1 000, one `pdf.too-many-findings` is added and later ones are dropped. |
| REP-8 | `document` is null when no trailer was read. Otherwise it holds what CAT, INF, and PG found; `catalog` and `info` are null when they could not be read. `pages` are in page tree order (PG-2). `outlineItems` and `fields` count the items ACT-12 and ACT-13 visited. |
| REP-9 | A `Text` with `text` null was not decoded because the file is encrypted (TXT-4). `truncated` is set by TXT-3. |
| REP-10 | `actions` are in the order found: catalog, `JavaScript` name tree, pages with their annotations, form fields, outline (ACT-1). `event` is the key that holds the action (`OpenAction`, `A`, an `AA` key, or `JavaScript`). `holder` is the page, annotation, field, or outline item object; `object` is the action's own object when it is indirect. `label` is the field name, outline title, or name tree key. |

## Findings

| ID | Severity | Rule | Clause |
|---|---|---|---|
| `pdf.header.missing` | error | HDR-1 | 7.5.2 |
| `pdf.header.offset` | warning | HDR-1 | 7.5.2 |
| `pdf.header.version` | info | HDR-2 | 7.5.2 |
| `pdf.startxref.missing` | error | EOF-2 | 7.5.5 |
| `pdf.eof.missing` | warning | EOF-3 | 7.5.5 |
| `pdf.eof.trailing` | warning | EOF-3 | 7.5.5 |
| `pdf.xref.out-of-range` | error | XREF-1 | 7.5.5 |
| `pdf.xref.not-found` | error | XREF-1 | 7.5.4 |
| `pdf.xref.entry-format` | warning | XREF-3 | 7.5.4 |
| `pdf.xref.duplicate-entry` | warning | XREF-4 | 7.5.4 |
| `pdf.xref.first-entry` | info | XREF-5 | 7.5.4 |
| `pdf.trailer.missing` | error | TRL-1 | 7.5.5 |
| `pdf.trailer.root` | error | TRL-2 | 7.5.5 |
| `pdf.trailer.size` | warning | TRL-2, REV-5 | 7.5.5 |
| `pdf.xref-stream.dict` | error | XST-1 | 7.5.8.2 |
| `pdf.xref-stream.filter` | error | XST-2 | 7.4.4.3 |
| `pdf.xref-stream.decode` | error | XST-2, XST-3 | 7.4.4.4 |
| `pdf.xref-stream.short` | warning | XST-5 | 7.5.8.3 |
| `pdf.xref.loop` | error | REV-3 | 7.5.6 |
| `pdf.xref.too-many-sections` | warning | REV-3 | — |
| `pdf.object.out-of-range` | error | OBX-1 | 7.5.4 |
| `pdf.object.header-mismatch` | error | OBX-1 | 7.3.10 |
| `pdf.object.endobj-missing` | warning | IND-5 | 7.3.10 |
| `pdf.object.too-large` | warning | OBX-2 | — |
| `pdf.stream.eol` | warning | IND-2 | 7.3.8.1 |
| `pdf.stream.length` | warning | IND-4 | 7.3.8.2 |
| `pdf.syntax.error` | warning | LEX-4, OBJ-2..5, OBJ-9 | 7.2 |
| `pdf.syntax.depth` | error | OBJ-9 | — |
| `pdf.dict.key` | warning | OBJ-7 | 7.3.7 |
| `pdf.dict.duplicate-key` | warning | OBJ-7 | 7.3.7 |
| `pdf.value-too-large` | error | OBJ-2 | — |
| `pdf.encrypted` | info | OBX-4 | 7.6.1 |
| `pdf.gap` | info | MAP-2 | 7.5.3 |
| `pdf.overlap` | error | MAP-3 | 7.5.4 |
| `pdf.too-many-objects` | warning | Limits | — |
| `pdf.too-many-findings` | info | REP-7 | — |
| `pdf.filter.error` | warning | FLT-2..5, FLT-7 | 7.4 |
| `pdf.filter.unsupported` | info | FLT-7, FLT-8 | 7.4.1 |
| `pdf.filter.limit` | warning | FLT-9 | — |
| `pdf.objstm.invalid` | error | OST-1, OST-2 | 7.5.7 |
| `pdf.objstm.missing` | error | OST-3 | 7.5.7 |
| `pdf.catalog.missing` | error | CAT-1 | 7.7.2 |
| `pdf.catalog.type` | warning | CAT-2 | 7.7.2 |
| `pdf.info.invalid` | warning | INF-1 | 14.3.3 |
| `pdf.pages.missing` | error | PG-1 | 7.7.2 |
| `pdf.pages.kid` | warning | PG-3 | 7.7.3.2 |
| `pdf.pages.loop` | error | PG-4 | 7.7.3.1 |
| `pdf.pages.count` | warning | PG-7 | 7.7.3.2 |
| `pdf.page.mediabox` | warning | PG-6 | 7.7.3.3 |
| `pdf.tree.loop` | warning | ACT-15 | — |
| `pdf.tree.limit` | warning | PG-4, PG-8, ANN-2, ACT-4, ACT-15 | — |
| `pdf.action.unknown` | info | ACT-3 | 12.6.4.1 |
| `pdf.action.loop` | warning | ACT-4 | 12.6.2 |
| `pdf.action.javascript` | warning | ACT-9 | 12.6.4.16 |
| `pdf.action.launch` | warning | ACT-9 | 12.6.4.5 |
| `pdf.action.submit-form` | warning | ACT-9 | 12.7.5.2 |
| `pdf.action.import-data` | warning | ACT-9 | 12.7.5.4 |
| `pdf.action.remote` | info | ACT-9 | 12.6.4.3 |
| `pdf.action.automatic` | warning | ACT-10 | 12.6.3 |
| `pdf.too-many-actions` | warning | ACT-11 | — |
