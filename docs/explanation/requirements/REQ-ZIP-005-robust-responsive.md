# REQ-ZIP-005: Robust and responsive analysis

Status: Accepted

## Need

- Archives may be huge, truncated, or crafted to break parsers.
- The page must stay usable.

## Requirement

- Malformed input never crashes the analysis; it produces findings.
- The analyzer reads only the byte ranges it needs. It never loads a whole large archive into memory.
- The UI never freezes during analysis.
- Work per analysis is bounded (entries, findings, nested depth, decompressed size).
- A new analysis replaces the previous one.

## Rationale

- Archives of several GiB are common. Reading them whole would exhaust memory.
- The central directory sits at the end, so the start of a huge file never needs reading.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Read the whole file, then parse | Fails on large archives |
| Parse on the main thread | Freezes the page on large central directories |

## Acceptance

- Fuzz-style tests with malformed archives finish without uncaught errors.
- A test archive larger than the bytes read shows that only the needed ranges were read.

## Specified in

- [ZIP analyzer limits](../../reference/zip/README.md#limits)
