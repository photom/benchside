import type { DkimSignatureResult } from '@benchside/mail';
import { FindingList } from './Findings.tsx';
import { resultText } from './labels.ts';
import { SourceLinks } from './SourceLinks.tsx';

/** Only this much of the canonical body is kept in the trace (DKIM-16). */
const TRACE_BODY_BYTES = 64 * 1024;

/** One card per DKIM-Signature: result, findings, and the DKIM-16 trace. */
export function DkimDetail({ results }: { results: readonly DkimSignatureResult[] }) {
  if (results.length === 0) return null;
  return (
    <section aria-label="DKIM">
      <h2>DKIM</h2>
      {results.map((r, n) => (
        <article key={n} class="method-result" data-result={r.result}>
          <h3>
            Signature {n + 1}: d={r.d ?? '?'} s={r.s ?? '?'}{' '}
            <span class="result">{resultText(r.result, r.reason)}</span>
          </h3>
          <p>
            <SourceLinks field={r.field} keyQueryId={r.keyQueryId} />
          </p>
          <FindingList findings={r.findings} />
          <Trace result={r} />
        </article>
      ))}
    </section>
  );
}

function Trace({ result }: { result: DkimSignatureResult }) {
  const { trace } = result;
  const bodyMismatch = trace.body !== undefined && trace.body.computed !== trace.body.expected;
  return (
    <>
      <details data-part="trace">
        <summary>Evaluation details</summary>
        <dl>
          <dt>Tags</dt>
          <dd>{trace.tags.map(([k, v]) => `${k}=${v}`).join('; ') || '(none)'}</dd>
          <dt>Signed header fields</dt>
          <dd>
            {trace.selectedHeaders.length === 0
              ? '(none)'
              : trace.selectedHeaders.map((i, n) => [
                  n > 0 && ', ',
                  <a key={i} href={`#field-${i + 1}`}>
                    {i + 1}
                  </a>,
                ])}
          </dd>
          {trace.headerData !== undefined && (
            <>
              <dt>Header hash input</dt>
              <dd>
                <pre>{trace.headerData}</pre>
              </dd>
            </>
          )}
        </dl>
      </details>
      {trace.body && (
        // REQ-MAIL-004: on a body hash mismatch, show what was hashed.
        <details data-part="body" open={bodyMismatch}>
          <summary>
            Canonicalized body ({trace.body.length} bytes
            {trace.body.length > TRACE_BODY_BYTES && `, first ${TRACE_BODY_BYTES} bytes shown`})
          </summary>
          <p>
            Computed body hash: <code>{trace.body.computed}</code>
            <br />
            Expected (bh=): <code>{trace.body.expected}</code>
          </p>
          <pre>{trace.body.canonical}</pre>
        </details>
      )}
    </>
  );
}
