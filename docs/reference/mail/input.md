# Input

## Message

| ID | Requirement |
|---|---|
| IN-1 | Accepts a message as a `.eml` file (drag and drop or file picker), as pasted raw source, or as headers only. |
| IN-2 | Keeps the original bytes. All hashes are computed from these bytes, never from decoded text. |
| IN-3 | Detects line endings. If the message uses bare LF, converts it to CRLF for verification and reports `input.lf-converted` (warning), because the conversion itself can cause hash mismatches. |
| IN-4 | When only headers are given, checks that need the body (DKIM body hash, DKIM2 body hash) are reported as not evaluated, not as failed. |
| IN-5 | Shows the MIME tree and the header fields with RFC 2047 encoded words decoded. Attachments are listed but not opened. |
| IN-6 | Rejects input larger than 50 MiB with `input.too-large` (error). |

## Delivery details

SPF and DKIM2 depend on the SMTP session, which is not part of a stored message. The analyzer needs:

| Detail | Used by |
|---|---|
| Client IP address | SPF |
| HELO/EHLO name | SPF |
| MAIL FROM (reverse-path) | SPF, DMARC, DKIM2 |
| RCPT TO (forward-paths) | DKIM2 |

| ID | Requirement |
|---|---|
| ENV-1 | Suggests values from the message: MAIL FROM from `Return-Path`; client IP address and HELO name from the `Received` field added at the trust boundary; RCPT TO from `Delivered-To` or the `for` clause of that `Received` field. |
| ENV-2 | The trust boundary is the topmost `Received` field by default. The user can choose a different `Received` field. |
| ENV-3 | The user can edit every value. |
| ENV-4 | The report states for each value whether it was inferred (and from which field) or entered by the user. |
| ENV-5 | If a value is missing, the checks that need it are reported as not evaluated. |

## Reference time

| ID | Requirement |
|---|---|
| TIME-1 | Time-dependent checks (DKIM `x=` and `t=`, DKIM2 `t=`, ARC `t=`) use a reference time chosen by the user: the current time, the `Date` field, or the time of the trust-boundary `Received` field. The default is the `Received` time, falling back to the current time. |
