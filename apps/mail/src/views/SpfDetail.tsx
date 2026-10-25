import type { SpfIdentityResult, SpfNode, SpfResults, SpfTermTrace } from '@benchside/mail';
import { FindingList } from './Findings.tsx';
import { HowChecked } from './HowChecked.tsx';
import { resultText } from './labels.ts';

const OUTCOME_WORDS: Record<SpfTermTrace['outcome'], string> = {
  match: 'match',
  'no-match': 'no match',
  error: 'error',
  'not-reached': 'not reached',
};

/** SPF per identity: result, counters, findings, and the record tree (REQ-MAIL-003, SPF-18, SPF-19). */
export function SpfDetail({ spf }: { spf: SpfResults }) {
  return (
    <section aria-label="SPF">
      <h2>SPF</h2>
      <Identity label="MAIL FROM" result={spf.mailFrom} />
      <Identity label="HELO" result={spf.helo} />
      <HowChecked method="spf" />
    </section>
  );
}

function Identity({ label, result }: { label: string; result: SpfIdentityResult }) {
  return (
    <article class="method-result" data-result={result.result}>
      <h3>
        {label}
        {result.domain !== undefined && `: ${result.domain}`}{' '}
        <span class="result">{resultText(result.result, result.reason)}</span>
      </h3>
      {result.sender !== undefined && <p>Sender: {result.sender}</p>}
      {result.trace && (
        <p>
          {result.counters.dnsTerms} / 10 DNS-querying terms, {result.counters.voids} / 2 void
          lookups
        </p>
      )}
      <FindingList findings={result.findings} />
      {result.explanation !== undefined && <p>Explanation: {result.explanation}</p>}
      {result.trace && <SpfRecord node={result.trace} />}
    </article>
  );
}

function SpfRecord({ node }: { node: SpfNode }) {
  return (
    <div data-part="spf-record" class="spf-record">
      <p>
        <strong>{node.domain}</strong> {resultText(node.result)}
        {node.queryId !== undefined && (
          <>
            {' '}
            <a href={`#dns-${node.queryId}`}>DNS {node.queryId}</a>
          </>
        )}
      </p>
      {node.record !== undefined ? <code>{node.record}</code> : <p>No SPF record.</p>}
      {node.terms.length > 0 && (
        <ul>
          {node.terms.map((t, i) => (
            <li key={i} data-outcome={t.outcome}>
              <code>{t.term}</code>: {OUTCOME_WORDS[t.outcome]}
              {t.queryIds.map((id) => [
                ' ',
                <a key={id} href={`#dns-${id}`}>
                  DNS {id}
                </a>,
              ])}
              {t.child && <SpfRecord node={t.child} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
