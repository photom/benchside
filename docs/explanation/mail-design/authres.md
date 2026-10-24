# Receiver results

Spec: [Receiver results](../../reference/mail/authres.md).

## Flow

```mermaid
flowchart LR
  ar[Authentication-Results] --> p["parse.ts<br/>RFC 8601 tokenizer"]
  rs[Received-SPF] --> p2["received-spf.ts"]
  p & p2 --> trust["trust by position<br/>vs boundary"]
  trust --> cmp["compare.ts"]
  ours[/our results/] --> cmp
  cmp --> causes["cause rules"]
  causes --> out[/"Comparison[]"/]
```

## Parsed form

```ts
interface AuthResult {
  field: number;
  trusted: boolean;
  authservId: string;
  entries: {
    method: string;                    // lowercase
    result: string;
    reason?: string;
    props: Record<string, string>;     // 'header.d', 'smtp.mailfrom', …
  }[];
}
```

- The tokenizer shares CFWS and quoted-string handling with the envelope tokenizer (`shared/rfc5322-tokens.ts`: 2 users).

## Matching

| Method | Our side | Key |
|---|---|---|
| `spf` | MAIL FROM or HELO identity | `smtp.mailfrom` / `smtp.helo` |
| `dkim` | one signature | `header.d` + `header.s`, else `header.b` prefix |
| `dmarc` | selected mode | `header.from` |
| `arc` | chain | — |

## Cause rules

```ts
interface CauseRule {
  id: 'key-changed' | 'dns-changed' | 'modified' | 'boundary' | 'line-endings';
  applies(diff: Difference, report: PartialReport): boolean;
}
```

- Rules are a plain array, evaluated in order; all that apply are listed.
- `dns-changed` applies only when no other rule matched.
