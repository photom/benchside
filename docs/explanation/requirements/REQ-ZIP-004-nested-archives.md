# REQ-ZIP-004: Open nested archives

Status: Accepted

## Need

- Archives often contain archives: `.jar` in `.war`, `.zip` in `.zip`, Office files in mail exports.
- Users want to look inside without extracting the outer archive by hand.

```mermaid
flowchart LR
  outer[outer.zip] --> inner[inner.zip] --> deeper[lib.jar]
```

## Requirement

- The user can open any file entry as an archive.
- Entries whose names suggest an archive are marked.
- The nested archive gets the same analysis as a top-level one.
- The page shows the path from the outer archive to the one being viewed, and the user can go back.
- Nesting depth and decompressed size are bounded.

## Rationale

- Opening on request keeps the first view fast; most entries are not archives.
- Decompression is required to see inside a compressed entry. It uses the browser's `DecompressionStream`, so no extra code is needed.
- Bounds stop a crafted archive from exhausting memory.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Open every nested archive automatically | Decompresses data the user may not care about; unbounded work |
| Detect archives by content only | Needs decompression first; names are a cheap hint, and the user can still open any entry |

## Acceptance

- A ZIP stored inside a ZIP, and a ZIP deflated inside a ZIP, both open and show their entries.
- A nested archive deeper than the limit is refused with a reason.
- An entry using an unsupported method is refused with a reason.

## Specified in

- [Nested archives](../../reference/zip/nested.md)
