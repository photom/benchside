# 0014: The DNS resolver moves into @benchside/dns

## Context

- The mail package has the resolver: query types, composition (log, budget, policy, cache), the session cache, and offline records. `toALabels` and `parseIp` sit in the mail package's shared helpers. SPF builds reverse names inline (`spf/evaluate.ts`).
- The DoH transport (`createDohTransport`) lives in `apps/mail`. Apps never import from other apps.
- The DMARC aggregate app is the second user (REQ-DMARC-008). It needs the transport, the cache, the budget, the log, and the sensitive-query gate. `@benchside/dmarc-aggregate` needs `parseIp` for FMT-12 and reverse names for RDNS-3.

## Decision

```mermaid
flowchart LR
  subgraph dns ["@benchside/dns"]
    types[types.ts] --- compose[compose.ts] --- cache[cache.ts]
    offline[offline.ts] --- idna["idna.ts<br/>toALabels"]
    ip["ip.ts<br/>parseIp, reverseName"]
    doh["doh.ts<br/>createDohTransport<br/>the only fetch"]
  end
  mail["@benchside/mail"] --> dns
  amail["apps/mail worker"] --> dns
  admarc["apps/dmarc-aggregate worker"] --> dns
  pdmarc["@benchside/dmarc-aggregate"] --> dns
```

- A new package, `@benchside/dns`, holds what both apps need: the types, `composeResolver`, the cache, offline records, IDNA conversion, IP parsing, reverse names, and the DoH transport.
- `reverseName(ip)` replaces the inline code in SPF, so both reverse lookups build names the same way (RFC 1035 §3.5, RFC 3596 §2.5).
- `doh.ts` is the only code in any package that calls `fetch`. Only app workers import it. Checks still receive a resolver and never see the transport.
- TXT joining (DNS-7) and the mail findings (`dnsFindings`) stay in the mail package. They are mail rules.
- `@benchside/mail` re-exports what it exported before, so its users do not change.
- The budget stays a parameter: 200 for mail (DNS-13), 2 000 per reverse lookup session (RDNS-6).

## Consequences

- One tested copy of the transport and the cache. The CSP allowlist and the endpoint list are still checked together by the build test.
- The rule "packages never call `fetch`" gets one named exception, `@benchside/dns/doh.ts`. Code review checks that no other package imports it.
- The refactor moves files and tests without changing behavior. It lands as its own change before the DMARC aggregate app uses it.
