/**
 * The standard behind each evaluation step (docs/reference/mail/citations.md, CITE-1..4).
 * citations.test.ts checks that this matches the reference page.
 */

export interface Step {
  readonly text: string;
  /** `RFC <n>`, `RFC <n> §<section>`, or `RFC <n> Appendix <x>` (CITE-2). */
  readonly cites: readonly string[];
  readonly why: string;
}

export type CitedMethod = 'delivery' | 'spf' | 'dkim' | 'rfc9989' | 'rfc7489' | 'arc' | 'receiver';

export const STEPS: Readonly<Record<CitedMethod, readonly Step[]>> = {
  delivery: [
    {
      text: 'Find the trust boundary in the Received fields, newest first',
      cites: ['RFC 5321 §4.4'],
      why: 'Each mail server adds its Received field on top, so the top fields come from the receiving side.',
    },
    {
      text: 'Take the client IP and HELO from the boundary Received field',
      cites: ['RFC 5321 §4.4'],
      why: "The from clause records the connecting host's address and HELO name.",
    },
    {
      text: 'Take MAIL FROM from Return-Path',
      cites: ['RFC 5321 §4.4'],
      why: 'The delivering server records the reverse-path in Return-Path.',
    },
    {
      text: "Take the reference time: the boundary field's date by default, or the Date field or the current time when chosen",
      cites: ['RFC 5322 §3.3'],
      why: 'Signature times are checked against when the message arrived, not against today.',
    },
  ],
  spf: [
    {
      text: 'Check the MAIL FROM and HELO identities',
      cites: ['RFC 7208 §2.3', 'RFC 7208 §2.4'],
      why: 'SPF authorizes these two identities. A null reverse-path uses postmaster at the HELO domain.',
    },
    {
      text: 'Check that the domain is usable',
      cites: ['RFC 7208 §4.3'],
      why: 'A malformed domain gives none without a lookup.',
    },
    {
      text: 'Look up and select the SPF record',
      cites: ['RFC 7208 §4.4', 'RFC 7208 §4.5'],
      why: 'One TXT record starting with v=spf1. None gives none; more than one gives permerror.',
    },
    {
      text: 'Evaluate the terms left to right',
      cites: ['RFC 7208 §4.6'],
      why: 'The first mechanism that matches decides, with its qualifier.',
    },
    {
      text: 'Evaluate each mechanism',
      cites: ['RFC 7208 §5'],
      why: 'all, include, a, mx, ptr, ip4, ip6, and exists each match in their own way.',
    },
    {
      text: 'Apply redirect and exp',
      cites: ['RFC 7208 §6.1', 'RFC 7208 §6.2'],
      why: 'redirect hands evaluation to another domain; exp explains a fail.',
    },
    {
      text: 'Expand macros',
      cites: ['RFC 7208 §7'],
      why: 'Names in terms can depend on the sender and client.',
    },
    {
      text: 'Enforce the DNS lookup limits',
      cites: ['RFC 7208 §4.6.4'],
      why: 'At most 10 DNS-querying terms and 2 void lookups, to bound DNS load.',
    },
    {
      text: 'Name the result',
      cites: ['RFC 7208 §2.6'],
      why: 'none, neutral, pass, fail, softfail, temperror, permerror.',
    },
  ],
  dkim: [
    {
      text: 'Parse the DKIM-Signature tags',
      cites: ['RFC 6376 §3.2', 'RFC 6376 §3.5'],
      why: 'The signature is a tag=value list with required tags.',
    },
    {
      text: 'Validate the signature field',
      cites: ['RFC 6376 §6.1.1'],
      why: 'Version, required tags, From signed, and expiry are checked before any lookup.',
    },
    {
      text: 'Accept only allowed algorithms',
      cites: ['RFC 8301 §3.1', 'RFC 8463'],
      why: 'rsa-sha1 must not be accepted; ed25519-sha256 is allowed.',
    },
    {
      text: 'Get the public key',
      cites: ['RFC 6376 §6.1.2', 'RFC 6376 §3.6.2'],
      why: 'The key is a TXT record at selector._domainkey.domain.',
    },
    {
      text: 'Check the key size',
      cites: ['RFC 8301 §3.2'],
      why: 'RSA keys shorter than 1024 bits are not accepted.',
    },
    {
      text: 'Canonicalize and hash the body',
      cites: ['RFC 6376 §3.4.3', 'RFC 6376 §3.4.4', 'RFC 6376 §3.7'],
      why: 'The body hash must equal bh=, or the body was changed.',
    },
    {
      text: 'Select and canonicalize the signed header fields',
      cites: ['RFC 6376 §5.4.2', 'RFC 6376 §3.4.1', 'RFC 6376 §3.4.2'],
      why: 'Fields listed in h= are taken bottom-up, so added fields cannot replace signed ones.',
    },
    {
      text: 'Verify the signature',
      cites: ['RFC 6376 §6.1.3'],
      why: 'The signature over the header data must verify with the key.',
    },
  ],
  rfc9989: [
    {
      text: 'Extract the author domain from From',
      cites: ['RFC 9989 §5.3.1'],
      why: 'DMARC protects the domain the reader sees.',
    },
    {
      text: 'Discover the policy record with the DNS tree walk',
      cites: ['RFC 9989 §4.10.1', 'RFC 9989 §5.3.2'],
      why: 'The record at the author domain, else the closest one above it.',
    },
    {
      text: 'Find the organizational domain',
      cites: ['RFC 9989 §4.10.2'],
      why: 'Relaxed alignment compares organizational domains.',
    },
    {
      text: 'Collect the authenticated identifiers',
      cites: ['RFC 9989 §5.3.3'],
      why: 'The SPF MAIL FROM domain and each DKIM d= domain, with their results.',
    },
    {
      text: 'Check identifier alignment',
      cites: ['RFC 9989 §5.3.4', 'RFC 9989 §4.4'],
      why: 'An identifier counts only if it matches the author domain, strictly or relaxed.',
    },
    {
      text: 'Decide pass or fail',
      cites: ['RFC 9989 §5.3.5'],
      why: 'Pass needs one aligned identifier that passed.',
    },
    {
      text: 'Read the policy tags',
      cites: ['RFC 9989 §4.7'],
      why: 'p, sp, np, and t say what the domain owner asks for.',
    },
    {
      text: 'Test whether the author domain exists',
      cites: ['RFC 9989 Appendix A.4'],
      why: 'np applies to domains that do not exist.',
    },
    {
      text: 'Apply the policy',
      cites: ['RFC 9989 §5.3.6'],
      why: 'A failing message gets the policy in effect; DNS errors mean no policy applies.',
    },
  ],
  rfc7489: [
    {
      text: 'Extract the author domain from From',
      cites: ['RFC 7489 §6.6.1'],
      why: 'DMARC protects the domain the reader sees.',
    },
    {
      text: 'Find the organizational domain with the Public Suffix List',
      cites: ['RFC 7489 §3.2'],
      why: 'The public suffix plus one label.',
    },
    {
      text: 'Discover the policy record',
      cites: ['RFC 7489 §6.6.3'],
      why: 'The author domain, then its organizational domain.',
    },
    {
      text: 'Read the record tags',
      cites: ['RFC 7489 §6.3'],
      why: 'p, sp, pct, adkim, aspf, and the rest, with their defaults.',
    },
    {
      text: 'Check identifier alignment',
      cites: ['RFC 7489 §3.1'],
      why: 'An identifier counts only if it matches the author domain, strictly or relaxed.',
    },
    {
      text: 'Decide pass or fail and the policy',
      cites: ['RFC 7489 §6.6.2'],
      why: 'Pass needs one aligned identifier that passed; otherwise the policy applies.',
    },
    {
      text: 'Apply pct sampling',
      cites: ['RFC 7489 §6.6.4'],
      why: 'pct below 100 applies the policy to only part of the failing mail.',
    },
  ],
  arc: [
    {
      text: 'Collect the ARC sets',
      cites: ['RFC 8617 §5.2', 'RFC 8617 §4.2.1'],
      why: 'Sets group by i=; more than 50 fails the chain.',
    },
    {
      text: "Check the newest seal's cv",
      cites: ['RFC 8617 §5.2'],
      why: 'A sealer that already saw a failed chain marked it cv=fail.',
    },
    {
      text: 'Validate the chain structure',
      cites: ['RFC 8617 §5.2', 'RFC 8617 §4.4'],
      why: 'One AAR, AMS, and AS per set, instances 1 to N, cv=none only on the first.',
    },
    {
      text: 'Verify the newest message signature',
      cites: ['RFC 8617 §4.1.2', 'RFC 8617 §5.2'],
      why: 'It is verified like a DKIM signature; a failure fails the chain.',
    },
    {
      text: 'Find the oldest hop that still verifies',
      cites: ['RFC 8617 §5.2'],
      why: 'Older message signatures show where the message was last changed.',
    },
    {
      text: 'Verify every seal',
      cites: ['RFC 8617 §4.1.3', 'RFC 8617 §5.2'],
      why: 'Each seal covers all sets up to it; any failure fails the chain.',
    },
  ],
  receiver: [
    {
      text: 'Parse Authentication-Results',
      cites: ['RFC 8601 §2.2'],
      why: 'Each field holds an authserv-id and method=result entries.',
    },
    {
      text: 'Trust only fields from inside the trust boundary',
      cites: ['RFC 8601 §1.2', 'RFC 8601 §5'],
      why: "Anyone can add the field; only the receiving side's own fields are believable.",
    },
  ],
};

/** CITE-3, in this order. */
export const REFERENCES: readonly { readonly rfc: number; readonly title: string }[] = [
  { rfc: 5321, title: 'Simple Mail Transfer Protocol' },
  { rfc: 5322, title: 'Internet Message Format' },
  {
    rfc: 7208,
    title: 'Sender Policy Framework (SPF) for Authorizing Use of Domains in Email, Version 1',
  },
  { rfc: 6376, title: 'DomainKeys Identified Mail (DKIM) Signatures' },
  {
    rfc: 8301,
    title: 'Cryptographic Algorithm and Key Usage Update to DomainKeys Identified Mail (DKIM)',
  },
  {
    rfc: 8463,
    title: 'A New Cryptographic Signature Method for DomainKeys Identified Mail (DKIM)',
  },
  { rfc: 9989, title: 'Domain-Based Message Authentication, Reporting, and Conformance (DMARC)' },
  { rfc: 7489, title: 'Domain-based Message Authentication, Reporting, and Conformance (DMARC)' },
  { rfc: 8617, title: 'The Authenticated Received Chain (ARC) Protocol' },
  { rfc: 8601, title: 'Message Header Field for Indicating Message Authentication Status' },
];

/** CITE-2 */
export function citeUrl(cite: string): string {
  const m = /^RFC (\d+)(?: §([\d.]+)| Appendix ([A-Z][\d.]*))?$/.exec(cite);
  if (!m) throw new Error(`Not a citation: ${cite}`);
  const base = `https://www.rfc-editor.org/rfc/rfc${m[1]}`;
  if (m[2]) return `${base}#section-${m[2]}`;
  if (m[3]) return `${base}#appendix-${m[3]}`;
  return base;
}
