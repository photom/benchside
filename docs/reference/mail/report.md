# Report

The output of one analysis. Plain data; crosses `postMessage` and is exported as JSON.

## Data model

```mermaid
classDiagram
  class Report {
    schema: "benchside.mail.report/1"
    analyzedAt: string
    options: Options
    envelope: Envelope
    summary: SummaryLine[]
    spf: SpfReport
    dkim: DkimSignatureReport[]
    dkim2: MethodReport
    dmarc: DmarcReport
    arc: ArcReport
    receiver: ReceiverReport
    findings: Finding[]
    dnsLog: DnsLogEntry[]
  }
  class MethodReport {
    method: Method
    result: string | "not-evaluated"
    reason?: string
    trace: TraceNode
    findingIds: string[]
  }
  class DkimSignatureReport {
    field: number
    result: string | "not-evaluated"
    reason?: string
    d?: string
    s?: string
    keyQueryId?: string
    trace: DkimTrace
    findingIds: string[]
  }
  class DkimTrace {
    tags: string[][]
    selectedHeaders: number[]
    headerData?: string
    body?: DkimBodyTrace
  }
  class DkimBodyTrace {
    canonical: string
    length: number
    computed: string
    expected: string
  }
  class ArcReport {
    result: "none" | "pass" | "fail" | "not-evaluated"
    reason?: string
    oldestPass?: number
    sets: ArcSetTrace[]
    findingIds: string[]
  }
  class ArcSetTrace {
    instance: number
    aar?: ArcAar
    ams?: ArcSignatureTrace
    seal?: ArcSignatureTrace
  }
  class ArcAar {
    field: number
    authservId: string
    entries: AuthResultEntry[]
  }
  class ArcSignatureTrace {
    field: number
    result: "pass" | "fail" | "not-evaluated" | "not-checked"
    reason?: string
    d?: string
    s?: string
    t?: string
    cv?: string
    keyQueryId?: string
  }
  class Envelope {
    clientIp?: EnvelopeValue
    helo?: EnvelopeValue
    mailFrom?: EnvelopeValue
  }
  class EnvelopeValue {
    value: string
    source: "user" | FieldSource
  }
  class FieldSource {
    field: number
    rule: string
  }
  class SpfReport {
    mailFrom: SpfIdentityReport
    helo: SpfIdentityReport
  }
  class SpfIdentityReport {
    result: string | "not-evaluated"
    reason?: string
    domain?: string
    sender?: string
    counters: SpfCounters
    trace?: SpfNode
    explanation?: string
    findingIds: string[]
  }
  class SpfCounters {
    dnsTerms: number
    voids: number
  }
  class SpfNode {
    domain: string
    record?: string
    queryId?: string
    result: string
    terms: SpfTermTrace[]
  }
  class SpfTermTrace {
    term: string
    outcome: "match" | "no-match" | "error" | "not-reached"
    queryIds: string[]
    child?: SpfNode
  }
  class DmarcReport {
    rfc9989?: DmarcModeReport
    rfc7489?: DmarcModeReport
  }
  class DmarcModeReport {
    result: string | "not-evaluated"
    reason?: string
    authorDomain?: string
    recordAt?: string
    record?: string
    orgDomain?: string
    orgDomainRule?: string
    declaredPolicy?: string
    policy?: string
    policySource?: "p" | "sp" | "np"
    testing: boolean
    disposition?: string
    alignment: AlignmentRow[]
    queryIds: string[]
    findingIds: string[]
  }
  class AlignmentRow {
    identifier: "spf" | "dkim"
    domain: string
    authResult: string
    mode: "strict" | "relaxed"
    orgDomain?: string
    aligned: boolean
    counts: boolean
  }
  class SummaryLine {
    method: Method
    result: string
    reason?: string
    counts?: Map~string, number~
    disposition?: string
    findingIds: string[]
  }
  class ReceiverReport {
    results: AuthResult[]
    comparisons: Comparison[]
  }
  class AuthResult {
    field: number
    trusted: boolean
    authservId: string
    entries: AuthResultEntry[]
  }
  class AuthResultEntry {
    method: string
    result: string
    reason?: string
    props: Map~string, string~
  }
  class TraceNode {
    label: string
    result?: string
    evidence: Evidence[]
    children: TraceNode[]
  }
  class Finding {
    key: string
    id: string
    severity: "error" | "warning" | "info"
    message: string
    evidence: Evidence[]
  }
  class Evidence {
    <<union>>
    header(index)
    bytes(start, end)
    dns(queryId)
  }
  Report --> MethodReport
  Report --> DkimSignatureReport
  DkimSignatureReport --> DkimTrace
  DkimTrace --> DkimBodyTrace
  Report --> ArcReport
  ArcReport --> ArcSetTrace
  ArcSetTrace --> ArcAar
  ArcSetTrace --> ArcSignatureTrace
  Report --> Envelope
  Envelope --> EnvelopeValue
  EnvelopeValue --> FieldSource
  Report --> SpfReport
  SpfReport --> SpfIdentityReport
  SpfIdentityReport --> SpfCounters
  SpfIdentityReport --> SpfNode
  SpfNode --> SpfTermTrace
  Report --> DmarcReport
  DmarcReport --> DmarcModeReport
  DmarcModeReport --> AlignmentRow
  Report --> SummaryLine
  Report --> Finding
  Report --> ReceiverReport
  ReceiverReport --> AuthResult
  MethodReport --> TraceNode
  TraceNode --> Evidence
  Finding --> Evidence
```

`Method` is `"spf" | "dkim" | "dkim2" | "dmarc" | "arc"`.

## Rules

| ID | Rule |
|---|---|
| REP-1 | `schema` changes its version number on any incompatible change. |
| REP-2 | `bytes` evidence uses offsets into the original input ([IN-8](input.md#line-endings)). |
| REP-3 | `Finding.id` is the finding name from the spec pages (for example `dkim.expired`). `Finding.key` is unique within the report; `findingIds` refer to it. |
| REP-4 | Every finding has at least one evidence item. |
| REP-5 | `not-evaluated` always has `reason`, one of: `no-body`, `missing-delivery-detail`, `sensitive-query-blocked`, `offline`, `budget-exhausted`, `timeout`, `unsupported`, `limit`, `invalid-input`, `internal-error`. |
| REP-6 | `dmarc.rfc7489` and `dmarc.rfc9989` are present for the modes the user selected. |
| REP-7 | An unexpected error inside one method makes that method `not-evaluated` (reason `internal-error`) with `analysis.internal-error` (error). Other methods are unaffected. DKIM guards each signature on its own: the finding sits with that signature, and finished signatures keep their results. A failure outside any signature points at the whole input. |
| REP-8 | When the 60 s deadline passes, unfinished methods are `not-evaluated` (reason `timeout`) with `analysis.timeout` (error). For DKIM this applies per unfinished signature. ARC is one method ([ARC-12](arc.md#signatures)). SPF guards each identity on its own. |

## Summary

| ID | Method | Summary result |
|---|---|---|
| SUM-1 | SPF | The MAIL FROM identity's result and its `reason`. `counts` is empty. Input over 50 MiB: `not-evaluated` with `invalid-input` |
| SUM-2 | DKIM | Precedence over all signatures: `pass` > `fail` > `permerror` > `temperror` > `neutral` > `not-evaluated`; `none` if no signatures. `counts` per result, listed in that order. If DKIM could not run at all: `not-evaluated` with `reason` (`internal-error`, or `invalid-input` for input over 50 MiB) |
| SUM-3 | DKIM2 | The DKIM2 result, plus stage |
| SUM-4 | DMARC | The default mode's (`rfc9989`) result, its `reason`, and `disposition` when the result is `pass` or `fail`. Input over 50 MiB: `not-evaluated` with `invalid-input` |
| SUM-5 | ARC | The chain result ([ARC-11](arc.md#signatures)) and its `reason`; `counts` has `sets`, the number of instances, when there is at least one. Input over 50 MiB: `not-evaluated` with `invalid-input` |

## Export

| ID | Rule |
|---|---|
| EXP-1 | The export is the `Report` serialized as JSON, UTF-8, generated in the browser. |
| EXP-2 | Without opt-in, the export omits: header values, body bytes, trace labels quoting message text, and `bytes` evidence content. Offsets remain. |
| EXP-3 | With opt-in, the export adds `message: { headers: string[] }`. Body bytes are never exported. |
