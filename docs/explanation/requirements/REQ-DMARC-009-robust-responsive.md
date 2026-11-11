# REQ-DMARC-009: Robust and responsive analysis

Status: Accepted

## Need

- Reports arrive by mail from anyone who claims to be a receiver. Anyone can forge them (RFC 9990 §8.2).
- The decompressor and XML parser are targets for bombs (RFC 9990 §8.1).
- A batch can hold thousands of files.

## Requirement

- Malformed files never crash the analysis. Each produces findings; the rest of the batch still loads.
- Work is bounded: files per batch, decompressed size, XML depth, records, DKIM results per record, findings.
- The XML reader never expands entities beyond the five predefined ones and character references. Documents with a DTD are refused.
- The UI stays responsive. Parsing runs in a worker.
- Each report shows the file it came from, so users can judge its origin.

## Rationale

- Refusing DTDs removes entity expansion bombs. Aggregate reports have no use for them.
- Per-file failure keeps one bad attachment from hiding a week of good data.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| `DOMParser` | Not available in workers; expands internal entities |
| Stop the batch at the first bad file | One broken report would hide the rest |

## Acceptance

- A file with `<!DOCTYPE` is refused with `aggregate.xml.doctype`; other files in the batch load.
- A gzip bomb stops at the decompression limit with a finding.
- Fuzz-style tests with truncated and malformed XML finish without uncaught errors.

## Specified in

- [Limits](../../reference/dmarc-aggregate/README.md#limits), [Input](../../reference/dmarc-aggregate/input.md), [XML reader](../../reference/dmarc-aggregate/xml.md)
