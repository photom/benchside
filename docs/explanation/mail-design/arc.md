# ARC

Spec: [ARC](../../reference/mail/arc.md).

## Flow

```mermaid
flowchart LR
  g["sets.ts<br/>group by i="] --> s[structure check]
  s --> ams["AMS N<br/>signature-core"]
  ams --> old["oldest pass<br/>AMS N-1..1"]
  old --> seal["seal.ts<br/>AS N..1"]
  seal --> res[result]
```

## Grouping (`sets.ts`)

```ts
interface ArcSet {
  instance: number;
  aar: HeaderField[];      // normally 1
  ams: HeaderField[];
  as: HeaderField[];
}
```

- `i=` is read with a minimal parse (`i=<digits>` before the first `;`), so grouping works even when the rest is malformed.
- Sets are kept as arrays so duplicates can be reported, not silently dropped.

## Seal input (`seal.ts`)

```mermaid
flowchart LR
  subgraph "AS i=3 signs"
    a1[AAR 1] --> m1[AMS 1] --> s1[AS 1] --> a2[AAR 2] --> m2[AMS 2] --> s2[AS 2] --> a3[AAR 3] --> m3[AMS 3] --> s3["AS 3<br/>b= emptied"]
  end
```

- Every field is canonicalized with `headerRelaxed`.
- The last field has no trailing CRLF.
- Reuses `signature-core.canonicalizeHeaders` with an explicit field list instead of `h=`.

## Verification order and cost

| Step | Signatures | Key lookups |
|---|---|---|
| AMS N | 1 | 1 |
| Oldest pass | up to N-1 | up to N-1 |
| AS N..1 | N | up to N |

- Keys are memoized per `(selector, domain)`. Typical chains reuse 1–3 keys.
- With N = 50, at most 100 key lookups; within the 200 DNS budget.

## Failure reporting

- RFC 8617 makes every error a `fail`. The finding keeps the cause (`arc.key` vs `arc.seal-mismatch`), so the UI can explain it.
- Evaluation does not stop at the first failure: all seals are checked so the timeline can show each hop's state.
