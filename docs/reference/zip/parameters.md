# Parameters

Values the user can change before or after choosing a file ([REQ-ZIP-008](../../explanation/requirements/REQ-ZIP-008-parameters.md)).

## Values

| ID | Parameter | Key | Default | Range | Used by |
|---|---|---|---|---|---|
| PAR-1 | Max nesting depth | `maxNestingDepth` | 8 | 1–32 | [NEST-2](nested.md) |
| PAR-2 | Max nested decompressed size | `maxNestedBytes` | 256 MiB | 1 MiB – 1 GiB | [NEST-2, NEST-3](nested.md) |
| PAR-3 | Compression ratio threshold | `ratioThreshold` | 100 | 10–10 000 | [SEC-10, SEC-11](security.md) |
| PAR-4 | Minimum size for the ratio check | `ratioMinBytes` | 1 MiB | 0 – 1 GiB | [SEC-10, SEC-11](security.md) |
| PAR-5 | Total uncompressed size threshold | `totalBytesThreshold` | 1 GiB | 1 MiB – 1 TiB | [SEC-12](security.md) |
| PAR-6 | Max number of files | `maxFiles` | 10 000 | 1 – 100 000 | [SEC-13](security.md) |
| PAR-7 | Target file system | `targetFileSystem` | `all` | `all`, `windows`, `macos`, `linux` | [SEC-5, SEC-6](security.md) |
| PAR-8 | Max path length | `maxPathBytes` | 4 096 | 1 – 65 535 | [SEC-9](security.md) |
| PAR-9 | Max path depth | `maxPathDepth` | 64 | 1 – 1 024 | [SEC-9](security.md) |
| PAR-10 | Security checks | `checks` | every check on | on or off per check | [Security checks](security.md#checks) |

## Rules

| ID | Rule |
|---|---|
| PAR-11 | A missing value takes its default. A number outside its range is clamped to the nearest end; a number that is not finite takes its default. Byte values are rounded down to whole bytes. |
| PAR-12 | The report carries the values it used, after PAR-11 ([REP-9](report.md#data-model)). |
| PAR-13 | A nested report uses the same values as the archive it was opened from. |
| PAR-14 | The read limit of 100 000 entries ([CD-5](structure.md#central-directory)) is not a parameter. |
