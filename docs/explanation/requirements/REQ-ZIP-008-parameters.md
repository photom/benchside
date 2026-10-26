# REQ-ZIP-008: Adjustable analysis parameters

Status: Accepted

## Need

- What counts as suspicious depends on the archive: a log bundle compresses 200:1 and is harmless, and a backup can hold 50 000 files.
- Users need to tune the limits and thresholds instead of ignoring warnings.

## Requirement

- These parameters can be changed in an Options panel:

| Parameter | Default |
|---|---|
| Max nesting depth | 8 |
| Max nested decompressed size | 256 MiB |
| Compression ratio threshold | 100 |
| Minimum size for the ratio check | 1 MiB |
| Total uncompressed size threshold | 1 GiB |
| Max number of files (warning) | 10 000 |
| Target file system | All |
| Max path length / depth | 4 096 bytes / 64 levels |
| Each security check | On |

- Changing an option analyzes the current file again.
- Values last for the visit only. Nothing is stored in the browser.
- The report records the values it used.
- The read limit of 100 000 entries stays fixed; it protects the page.

## Rationale

- Recording the values makes a report reproducible and explains each warning.
- Not storing values avoids stale settings and keeps the privacy model simple ([REQ-ZIP-001](REQ-ZIP-001-local-only.md)).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Remember values in `localStorage` | A threshold changed for one archive silently applies to the next |
| Only the three most-asked parameters | Name checks need a target file system to avoid false alarms |

## Acceptance

- Raising the ratio threshold removes a ratio warning without reloading the file.
- Lowering max nesting depth to 1 refuses to open an archive inside a nested archive.
- Reloading the page restores every default.
- The report lists the parameter values used.

## Specified in

- [Parameters](../../reference/zip/parameters.md)
