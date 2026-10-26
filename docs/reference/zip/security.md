# Security checks

Warnings about archives built to harm extraction ([REQ-ZIP-006](../../explanation/requirements/REQ-ZIP-006-security-checks.md)). The checks read only what the analysis has already read: names, sizes, attributes, and the byte map. No entry is decompressed.

## Inputs

| Term | Meaning |
|---|---|
| Name | The entry's decoded name ([NAME-1..3](fields.md#names-and-comments)) |
| Components | The name split on `/` and `\`, empty parts dropped |
| File entry | An entry whose kind is `file` ([CD-6](structure.md#central-directory)) |
| Sizes | Central effective sizes ([REP-4](report.md#data-model)) |

## Checks

Each check has a key, used by [PAR-10](parameters.md) to turn it off. A check that is off gives no findings.

| ID | Key | Rule | Finding |
|---|---|---|---|
| SEC-1 | `path-traversal` | A component is `..` | `sec.path-traversal` (error) |
| SEC-2 | `absolute-path` | The name starts with `/` or `\`, or with a drive letter and colon such as `C:` (4.4.17.1) | `sec.absolute-path` (error) |
| SEC-3 | `backslash` | The name contains `\` (4.4.17.1: separators MUST be forward slashes) | `sec.backslash` (warning) |
| SEC-4 | `duplicate-name` | Two or more entries have exactly the same name | `sec.duplicate-name` (warning), once per name, naming every entry |
| SEC-5 | `name-collision` | Two or more entries have different names that are the same file on the target file system (SEC-5a); exact duplicates are left to SEC-4 | `sec.name-collision` (warning), once per group |
| SEC-6 | `reserved-name` | On `windows` or `all`, a component is a reserved device name, contains a character Windows forbids, or ends with a dot or space (SEC-6a) | `sec.reserved-name` (warning) |
| SEC-7 | `symlink` | The host is UNIX (3) and the UNIX file type in the external attributes is a symbolic link ([FLD-7](fields.md#attributes)) | `sec.symlink` (warning) |
| SEC-8 | `control-character` | The name contains U+0000–U+001F, U+007F, or U+0080–U+009F | `sec.control-character` (warning) |
| SEC-8b | `bidi-character` | The name contains U+061C, U+200E, U+200F, U+202A–U+202E, or U+2066–U+2069 | `sec.bidi-character` (warning) |
| SEC-9 | `long-path` | The name's UTF-8 length is above `maxPathBytes`, or it has more components than `maxPathDepth` | `sec.long-path` (warning) |
| SEC-10 | `compression-ratio` | A file entry's uncompressed size is at least `ratioMinBytes`, and uncompressed ÷ compressed is above `ratioThreshold`. A compressed size of 0 counts as above | `sec.compression-ratio` (warning) |
| SEC-11 | `compression-ratio` | Over all file entries, the total uncompressed size is at least `ratioMinBytes`, and total uncompressed ÷ total compressed is above `ratioThreshold` | `sec.archive-ratio` (warning) |
| SEC-12 | `total-size` | The total uncompressed size of all file entries is above `totalBytesThreshold` | `sec.total-size` (warning) |
| SEC-13 | `file-count` | The effective entry count ([Z64-4](structure.md#zip64)) is above `maxFiles` | `sec.file-count` (warning) |
| SEC-14 | `overlapping-entries` | The file data of two entries share bytes, or two entries use the same local header | `sec.overlapping-entries` (error), once per entry that shares bytes with an entry starting before it, naming both (one finding per entry keeps the work linear) |

### SEC-5a: same file on the target file system

Two names are compared after these steps, in order:

| Target | Steps |
|---|---|
| `linux` | None; only exact duplicates collide (SEC-4) |
| `macos` | Unicode NFC normalization, then case folding |
| `windows` | Remove trailing dots and spaces from each component, then case folding |
| `all` | All of the `macos` and `windows` steps |

Case folding is JavaScript `toLowerCase()` after `toUpperCase()`. Components are joined with `/` again before comparing.

### SEC-6a: Windows names

| Kind | Values |
|---|---|
| Reserved device names | `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, compared without case, with or without an extension (`nul.txt`) |
| Forbidden characters | `<`, `>`, `:`, `"`, `\|`, `?`, `*` |
| Trailing characters | A dot or a space at the end of a component |

## Messages

| ID | Rule |
|---|---|
| SEC-15 | A finding about one entry carries that entry's index and its central header offset. A finding about several entries carries the first entry's index and names all of them in the message. |
| SEC-16 | A threshold finding states the measured value and the threshold, for example "ratio 1024 is above 100". |
