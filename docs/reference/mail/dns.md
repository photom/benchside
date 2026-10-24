# DNS

| ID | Requirement |
|---|---|
| DNS-1 | Looks up records with DNS-over-HTTPS using the JSON API. Providers: Cloudflare (`https://cloudflare-dns.com/dns-query`, default) and Google (`https://dns.google/resolve`). |
| DNS-2 | Queries contain only the record name and type. No other data from the message is sent. |
| DNS-3 | Offline mode sends no queries. In offline mode the user can enter TXT records by hand; checks that need a missing record are reported as not evaluated. |
| DNS-4 | Every query is logged with name, type, provider, response code, answers, AD (DNSSEC authenticated data) flag, and time taken. Each check links to the queries it used. |
| DNS-5 | TXT records made of several strings are joined without separators before parsing (RFC 7208 §3.3, RFC 6376 §3.6.2.2). |
| DNS-6 | A query that times out (5 seconds) or returns SERVFAIL is a temporary error. NXDOMAIN and empty answers are distinguished. |
| DNS-7 | Answers are cached for the current session only, and are never stored. |
| DNS-8 | The report states that DNS answers reflect the records at the time of analysis, not at delivery time. |
| DNS-9 | The page's Content Security Policy allows connections to the two providers only. |

Note: the DoH provider can see which domains and DKIM selectors are queried. This is stated in the [privacy model](../../explanation/privacy-model.md).
