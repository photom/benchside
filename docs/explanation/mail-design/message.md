# Message

Spec: [Input](../../reference/mail/input.md).

## Pipeline

```mermaid
flowchart LR
  in[/original bytes/] --> size{"> 50 MiB?"}
  size -->|yes| stop[input.too-large]
  size -->|no| le["line-endings.ts<br/>find, then copy"]
  le --> norm[/"normalized + insertion points"/]
  norm --> hdr["headers.ts<br/>split fields"]
  hdr --> end_{"empty line found?"}
  end_ -->|no| ho[body = null]
  end_ -->|yes| body["body range"]
  body --> mime["mime.ts<br/>recursive, depth ≤ 32"]
```

## Line endings (`line-endings.ts`)

```ts
interface Normalized {
  bytes: Uint8Array;            // CRLF everywhere a bare LF was
  findings: Finding[];          // input.lf-converted / line-endings-mixed / bare-cr (IN-13)
  toOriginal(offset: number): number; // binary search over the inserted-CR offsets
}
```

| Step | Detail |
|---|---|
| Find | `indexOf` finds the bare LFs (and up to 100 bare CRs), to allocate `bytes` once |
| Copy | Copies the segments between bare LFs with `set`, inserting a CR before each and recording its offset |
| Map back | `toOriginal(n) = n − (number of inserted < n)`, binary search: O(log k). An inserted CR maps to the LF after it |
| CRLF-only input | `bytes` is the original array itself; no copy |
| Evidence | First bare LF offset and up to 100 bare CR offsets, recorded during the find step (IN-13) |

## Header fields (`headers.ts`)

```mermaid
stateDiagram-v2
  [*] --> LineStart
  LineStart --> Continuation: SP or HTAB
  LineStart --> EndOfHeaders: CRLF
  LineStart --> NewField: other byte
  NewField --> LineStart: CRLF (name ends at first colon)
  Continuation --> LineStart: CRLF (append to current field)
  EndOfHeaders --> [*]
```

| Case | Handling |
|---|---|
| Line without colon | `input.malformed-header`; kept as raw, `lname` = `""` so no check matches it |
| Continuation before any field | Same as line without colon |
| More than 10 000 fields | `input.too-many-headers`; stop |
| Field name | ASCII bytes before the colon; trailing WSP before the colon is kept in `raw`, trimmed from `name` |
| `value` | Bytes after the colon, CRLF removed before WSP (unfold), decoded as UTF-8 with replacement |

`raw` keeps the exact bytes. Canonicalization reads `raw`, never `value`.

## MIME (`mime.ts`)

```ts
interface MimeNode {
  range: ByteRange;             // whole part incl. its headers
  headers: HeaderField[];
  contentType: { type: string; subtype: string; params: Map<string, string> };
  transferEncoding: string;     // lowercase, default '7bit'
  body: ByteRange;
  children: MimeNode[];         // multipart only
}
```

| Step | Detail |
|---|---|
| Content-Type | RFC 2045 token/quoted-string parameters; RFC 2231 continuations (`name*0`) joined |
| Boundary search | Byte search for `CRLF--boundary`; the first part may start at offset 0 without CRLF |
| Close delimiter | `--boundary--`; missing → `input.mime-boundary`, part ends at parent end |
| Depth | Recursion depth counter; > 32 → `input.mime-too-deep`, child kept opaque |
| Bodies | Never decoded during analysis. Decoded only when the UI asks to display a part |

## Encoded words (`encoded-words.ts`)

| Step | Detail |
|---|---|
| Find | `=?charset?B|Q?text?=`, adjacent words separated only by WSP are joined |
| Decode | `new TextDecoder(charset)`; unknown label → raw text + `input.encoded-word` |
| Use | Display only. Checks never see decoded words |
