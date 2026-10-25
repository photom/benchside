# REQ-ZIP-003: Read ZIP64 archives

Status: Accepted

## Need

- Archives over 4 GiB, or with more than 65 535 entries, use ZIP64.
- Some tools write ZIP64 records even for small archives.

## Requirement

- The analyzer reads the ZIP64 end of central directory record and locator.
- It reads the ZIP64 extended information extra field in central and local headers.
- It shows which values came from ZIP64 records.
- 64-bit values beyond what JavaScript numbers hold exactly are reported, not rounded.

## Rationale

- Without ZIP64, large archives show wrong sizes and offsets, or no entries.
- Mixed ZIP64 and 32-bit values that disagree are a structural fact worth showing.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Read only the 32-bit fields | Fails on every large archive |
| Use `BigInt` everywhere | Slower and awkward in the UI; values above 2^53 bytes do not occur in files a browser can open |

## Acceptance

- A ZIP64 archive built in a test shows the right entry count, sizes, and offsets.
- A sentinel value (`0xFFFFFFFF`) without its ZIP64 field produces a finding.

## Specified in

- [Structure](../../reference/zip/structure.md#zip64)
