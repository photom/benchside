# 0007: ZIP analyzer reads ranges from the end, nested archives in memory

## Context

ZIP archives can be several GiB. The central directory, which lists every entry, sits at the end (APPNOTE 4.3.6). A browser can read any byte range of a `File` with `File.slice()` without loading the rest.

Nested archives must be decompressed before they can be read. Their content exists only in memory.

## Decision

- `@benchside/zip` reads through a small `ByteSource` interface: a length and an async `read(offset, byteLength)`.
  - `blobSource(blob)` serves a `File` or `Blob` with `slice()`.
  - `bytesSource(bytes)` serves a `Uint8Array`, for nested archives and tests.
- Parsing follows the central directory, like common ZIP readers. It never scans the whole file for signatures.
- Small reads go through a cached window, so the many small reads of a central directory become a few large ones. Local headers use a smaller window (64 KiB), since they sit far apart.
- A nested archive is opened only on request. Its content is decompressed with `DecompressionStream('deflate-raw')` into memory, bounded by the limits in the spec, then wrapped in `bytesSource`.
- One exception to "never scans": the bytes no record accounts for (prepended data, gaps, trailing data) are scanned for local and central header signatures, at most 16 MiB per archive ([RD-4, RD-5](../../reference/zip/disagreement.md)). These regions are where hidden entries live, and they are usually small.
- The worker keeps the `File` and the chain of opened nested archives. It drops nested content that is not on the path currently viewed.

## Consequences

- Memory use for a top-level archive depends on its central directory, not its size.
- Data that no central header points at (for example, local headers left behind by an append) is shown as a gap. Header signatures inside it are reported, but the entries are not parsed further.
- One nested archive can hold up to 256 MiB in memory; a chain of eight can hold more. The UI shows one chain at a time, so siblings do not add up.
- The same parser runs on a `File` in the browser and on a `Uint8Array` in Node tests.
