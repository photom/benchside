# REQ-ZIP-009: Hex view of records and fields

Status: Accepted

## Need

- Decoded values hide how they were stored. Analysts want to check the bytes behind a field or a finding.

## Requirement

- Selecting a byte-map region, an entry's header or data, a header field, or a finding with an offset shows those bytes in hex and ASCII.
- Bytes of a header are labelled with their field names (APPNOTE layout tables).
- The view reads only the bytes shown, so it works on archives of any size.
- Long regions are paged or scrolled without rendering every byte at once.

## Rationale

- Every finding already has an offset; a hex view makes it checkable.
- Reading only the shown range keeps memory bounded ([REQ-ZIP-005](REQ-ZIP-005-robust-responsive.md)).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Full-file hex editor | Large; editing is out of scope |
| Download the region and use another tool | Breaks the flow and needs a second tool |

## Acceptance

- Selecting a central header shows its 46 fixed bytes labelled signature, version made by, … relative offset of local header, followed by name, extra field, and comment.
- Selecting the file data of a 1 GiB entry shows its first bytes without reading the rest.

## Specified in

- [Hex view](../../reference/zip/hex-view.md) (HEX-1..11)
- Design: [0008](../decisions/0008-zip-hex-view-reads-through-the-worker.md)
