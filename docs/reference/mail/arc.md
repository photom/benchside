# ARC

Standard: RFC 8617 (Experimental).

| ID | Requirement |
|---|---|
| ARC-1 | Groups `ARC-Authentication-Results`, `ARC-Message-Signature`, and `ARC-Seal` fields into sets by `i=`. Instances range from 1 to 50. |
| ARC-2 | Checks the structure: each instance has exactly one field of each kind, instances have no gaps, and instance 1 has `cv=none` while later instances do not. A structural error makes the chain `fail`. |
| ARC-3 | Verifies the `ARC-Message-Signature` of the highest instance, and of lower instances to find the oldest instance that still passes. |
| ARC-4 | Verifies every `ARC-Seal`. |
| ARC-5 | Results: `none` (no ARC fields), `pass`, `fail`, with the reason for a failure. |
| ARC-6 | Shows the chain as a timeline: one row per instance with the signing domain, time, `cv=`, and the authentication results recorded by that hop. |

## Findings

| ID | Severity | Condition |
|---|---|---|
| `arc.structure` | error | Missing, duplicate, or out-of-range instances |
| `arc.seal-mismatch` | error | An `ARC-Seal` does not verify |
| `arc.ams-mismatch` | error | The highest `ARC-Message-Signature` does not verify |
| `arc.cv-fail` | error | An instance records `cv=fail` |
| `arc.later-hop-modified` | info | An older `ARC-Message-Signature` fails while the newest passes, meaning a later hop modified the message |
