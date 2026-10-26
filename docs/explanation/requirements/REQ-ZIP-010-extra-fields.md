# REQ-ZIP-010: Decode more extra fields

Status: Accepted

## Need

- The header times are local times with 2-second precision and no time zone (APPNOTE 4.4.6). The real timestamps, owners, and encryption details sit in extra fields that the analyzer shows only as hex.

## Requirement

- The analyzer decodes these extra fields:

| ID | Name | Shows |
|---|---|---|
| 0x5455 | Extended timestamp | Modification, access, and creation times in UTC |
| 0x7875 | Info-ZIP UNIX (newer) | UID and GID |
| 0x000a | NTFS | Modification, access, and creation times in UTC |
| 0x9901 | AE-x (AES) | AES strength, vendor version, and the real compression method |
| 0xd935 | Android ZIP alignment | Alignment and padding |

- A malformed block keeps its hex preview and gives a finding.
- Zero bytes that older `zipalign` adds to a local extra field are shown as padding, not as a malformed block.

## Rationale

- These are the extra fields most common in archives made by Info-ZIP, Windows, 7-Zip, WinZip, and Android tools.
- UTC times and AES details answer questions users ask often: when was this file really made, and how strongly is it encrypted.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Decode every ID in APPNOTE 4.5 and 4.6 | Most are rare; their layouts are often undocumented |

## Acceptance

- An archive made by Info-ZIP `zip` shows the 0x5455 time in UTC.
- A WinZip AES archive shows the AES strength and the real method.
- An APK aligned by `apksigner` shows the alignment and whether the file data is aligned.
- An APK padded by older `zipalign` gives no `zip.extra.malformed` finding.

## Specified in

- [Fields: extra fields](../../reference/zip/fields.md#extra-fields) (EXT-1, EXT-3, EXT-5..10)
