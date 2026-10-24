# REQ-MAIL-008: Compare with the receiver's results

Status: Accepted

## Need

- The receiving server already recorded its verdict in `Authentication-Results`.
- Users ask: "Why did my server say fail when the tool says pass?"

## Requirement

- Parse the receiver's recorded results from `Authentication-Results`. `Received-SPF` is not used.
- Compare them with ours, method by method, and explain likely causes of differences.
- Mark recorded results from outside the trust boundary as untrusted.

## Rationale

- Re-verification happens later than delivery. Keys rotate and DNS changes. The comparison makes this visible instead of confusing.

## Acceptance

- Each difference lists at least one likely cause.
- A message delivered by a receiver that writes `Authentication-Results` below its own `Received` field (for example Gmail) shows those results as trusted.
- A forged `Authentication-Results` added by the sender is shown as untrusted. This assumes the boundary host removes fields that claim its own `authserv-id`, as RFC 8601 §5 requires.
- Receiver results are shown even before our own checks exist for a method.

## Specified in

- [Receiver results](../../reference/mail/authres.md)
