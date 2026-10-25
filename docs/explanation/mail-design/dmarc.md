# DMARC

Spec: [DMARC](../../reference/mail/dmarc.md).

## Structure

```mermaid
flowchart TD
  from["author.ts<br/>From → domains"] --> ev["evaluate.ts"]
  ev --> mode{mode}
  mode -->|rfc9989| d9["discover-rfc9989.ts<br/>tree walk"]
  mode -->|rfc7489| d7["discover-rfc7489.ts<br/>PSL"]
  d9 & d7 --> disc[/Discovery/]
  disc --> al["align.ts"]
  al --> pol["policy.ts"]
  psl["psl/lookup.ts"] --> d7
  psl --> al
```

Build order: `rfc9989` first (no PSL needed), then `rfc7489` with the PSL snapshot and the mode option. Until then `ModeStrategy` has one implementation; `align.ts` and `policy.ts` live in `evaluate.ts` and move out when the second mode arrives. `record.ts` parses and validates records (DMARC-9..11, DMARC-23).

Both modes share one interface. `evaluate.ts` does not branch on mode except to pick the discovery and org-domain functions.

```ts
interface Discovery {
  record: DmarcRecord | null;
  foundAt: string | null;               // name the record was found at
  orgDomain: string;
  orgDomainRule: string;                // 'psd=n at x', 'shortest record', or PSL rule
  queries: string[];                    // query IDs, for evidence
}
interface ModeStrategy {
  discover(ctx, authorDomain): Promise<Discovery | { error: 'temperror' }>;
  orgDomainOf(name): Promise<string>;   // used by relaxed alignment
  tags: ReadonlySet<string>;
}
```

## Author domain (`author.ts`)

| Input | `rfc9989` | `rfc7489` |
|---|---|---|
| No / several `From` fields | `not-evaluated` | `not-evaluated` |
| One address | its domain | its domain |
| Several addresses, one domain | that domain + warning | that domain |
| Several domains | `not-evaluated` | evaluate each; strictest failing policy |
| Group syntax, no address | `not-evaluated` | `not-evaluated` |

Address parsing: RFC 5322 `address-list` with comments, quoted local parts, and groups. Only the domain is used.

## Tree walk (`discover-rfc9989.ts`)

```mermaid
flowchart TD
  a["query _dmarc.author"] -->|valid| use[record = this]
  a -->|none| start{"labels > 8?"}
  start -->|yes| trim[start at rightmost 7]
  start -->|no| parent[start at parent]
  trim & parent --> q[query _dmarc.name]
  q --> psd{"psd=y or psd=n?"}
  psd -->|yes| stop[stop]
  psd -->|no| more{"labels left and < 8 queries?"}
  more -->|yes| drop[drop leftmost label] --> q
  more -->|no| stop
```

- All records found are kept, longest name first, for org-domain selection (DMARC-6).
- `orgDomainOf(name)` for alignment runs the same walk on the other domain. Answers come from the session cache when names overlap.

## PSL (`psl/lookup.ts`)

```mermaid
flowchart LR
  raw["data/public_suffix_list.dat?raw"] -->|first use| parse[parse rules]
  parse --> trie[(reversed-label trie<br/>normal, wildcard, exception)]
  name[domain] --> trie --> rule[longest match] --> org[org domain = suffix + 1 label]
```

- Snapshot date comes from the file's `// VERSION:` header line.
- Parse cost is paid once per worker lifetime.

## Alignment table (`align.ts`)

```ts
interface AlignmentRow {
  identifier: 'spf' | 'dkim';
  domain: string;                // SPF MAIL FROM domain or DKIM d=
  authResult: string;            // spf / dkim result
  mode: 'strict' | 'relaxed';    // aspf / adkim
  orgDomain?: string;            // relaxed only, when looked up
  aligned: boolean;
  counts: boolean;               // authResult is pass and aligned
}
```

- DMARC `pass` ⇔ some row has `counts: true`.
- Rows are built concurrently. A relaxed row walks only domains that equal or end in the author's organizational domain (DMARC-25); others cannot align.
- `analyze` starts DMARC as soon as SPF and DKIM finish, alongside ARC.

## Policy (`policy.ts`)

```mermaid
flowchart TD
  r{record found at} -->|author domain| p[p]
  r -->|org domain| ex{author exists?<br/>A query}
  ex -->|yes| sp[sp, else p]
  ex -->|NXDOMAIN, rfc9989| np[np, else p]
  p & sp & np --> t{"t=y (rfc9989)"}
  t -->|yes| lower[lower one level]
  t -->|no| keep[keep]
  lower & keep --> pct{"pct < 100 (rfc7489)"}
  pct -->|yes| two[two weighted dispositions]
  pct -->|no| one[one disposition]
```

- The existence query runs only when the record came from the org domain.
- Both modes can run concurrently; they share the DNS cache.
