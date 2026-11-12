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
    txt["txt.ts<br/>joinTxtData"]
    doh["doh.ts<br/>createDohTransport<br/>the only fetch"]
  end
  mail["@benchside/mail"] --> dns
  amail["apps/mail worker"] --> dns
  admarc["apps/dmarc-aggregate worker"] --> dns
  pdmarc["@benchside/dmarc-aggregate"] --> dns
```

- A new package, `@benchside/dns`, holds what both apps need: the types, `composeResolver`, the cache, offline records, IDNA conversion, IP parsing, reverse names, TXT joining, and the DoH transport.
- `reverseName(ip)` replaces the inline code in SPF, so both reverse lookups build names the same way (RFC 1035 §3.5, RFC 3596 §2.5). `nibbles(bytes)` is the shared IPv6 expansion behind it and SPF's `%{i}`.
- `parseIp` keeps the mail rules ENV-6, ENV-7, and ENV-17. FMT-12 is stricter (no brackets, no tag), so the DMARC aggregate parser checks the form before it calls `parseIp`.
- `doh.ts` is the only code in any package that calls `fetch`. It is a separate entry point, `@benchside/dns/doh`, so importing `@benchside/dns` never loads it. Only app workers import it. Checks still receive a resolver and never see the transport.
- TXT joining (DNS-7) moves too: the DoH transport applies it to every TXT answer.
- The mail findings (`dnsFindings`), `isDomainName` (RFC 6376), `isPublic` (ENV-8), and `inCidr` (SPF-22) stay in the mail package. They are mail rules.
- `@benchside/mail` stops exporting DNS symbols. The mail app was their only user, and it now imports them from `@benchside/dns`, so each symbol has one public path.
- The budget stays a parameter: 200 for mail (DNS-13), 2 000 per reverse lookup session (RDNS-6).

## Consequences

- One tested copy of the transport and the cache. `vite.shared.test.ts` checks that the transport's endpoints (`DOH_ENDPOINTS`) and `DOH_ORIGINS` name the same origins. The build test checks each app's CSP against `DOH_ORIGINS`.
- The rule "packages never call `fetch`" gets one named exception, `@benchside/dns/doh.ts`. Lint checks both sides:
  - In every package except that file, lint denies the request APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `importScripts`) and the objects that reach them (`navigator`, `globalThis`, `self`).
  - Only the app worker entries (`apps/*/src/worker/worker.ts`) may import `@benchside/dns/doh`.
  - A denylist cannot catch every route, such as a relative path to `doh.ts` or reaching the global object indirectly. Each app's CSP `connect-src` is the hard limit; lint catches mistakes early.
- The refactor moves files and tests without changing behavior. It lands as its own change before the DMARC aggregate app uses it.
