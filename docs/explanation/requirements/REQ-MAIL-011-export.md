# REQ-MAIL-011: Export the report

Status: Accepted

## Need

- Users attach findings to tickets or compare runs.

## Requirement

- Export the report as JSON, generated in the browser.
- The export contains no message content unless the user opts in.

## Rationale

- JSON is machine-readable and diffable.
- Excluding content by default keeps exports safe to share.

## Acceptance

- An export made without opt-in contains no header values or body bytes.

## Specified in

- [Report](../../reference/mail/report.md)
