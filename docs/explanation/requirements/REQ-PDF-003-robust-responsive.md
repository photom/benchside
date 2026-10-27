# REQ-PDF-003: Robust and responsive analysis

Status: Accepted

## Need

- PDFs may be huge, truncated, or crafted to break parsers.
- The page must stay usable.

## Requirement

- Malformed input never crashes the analysis; it produces findings.
- The analyzer reads only the byte ranges it needs. It never loads a whole large PDF into memory.
- The UI never freezes during analysis.
- Work per analysis is bounded: revisions, objects, nesting, decoded stream size, findings.
- Loops in the file (a `/Prev` that points back) end with a finding.
- A new analysis replaces the previous one.

## Rationale

- PDFs of hundreds of MiB are common (scans, print files).
- The cross-reference information sits at the end, so most of a large file's bytes are never needed for the structure.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Read the whole file, then parse | Fails on large files |
| Parse on the main thread | Freezes the page |

## Acceptance

- Fuzz-style tests with malformed PDFs finish without uncaught errors.
- A test file larger than the bytes read shows that only the needed ranges were read.
- A file whose `/Prev` points to itself ends with `pdf.xref.loop`.

## Specified in

- [PDF analyzer limits](../../reference/pdf/README.md#limits)
