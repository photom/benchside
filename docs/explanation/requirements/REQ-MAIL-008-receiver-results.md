# REQ-MAIL-008: Compare with the receiver's results

Status: Accepted

## Need

- The receiving server already recorded its verdict in `Authentication-Results`.
- Users ask: "Why did my server say fail when the tool says pass?"

## Requirement

- Parse the receiver's recorded results.
- Compare them with ours, method by method, and explain likely causes of differences.
- Mark recorded results from outside the trust boundary as untrusted.

## Rationale

- Re-verification happens later than delivery. Keys rotate and DNS changes. The comparison makes this visible instead of confusing.

## Acceptance

- Each difference lists at least one likely cause.

## Specified in

- [Receiver results](../../reference/mail/authres.md)
