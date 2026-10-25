import type { DmarcModeResult, DmarcResults } from '@benchside/mail';
import { FindingList } from './Findings.tsx';
import { HowChecked } from './HowChecked.tsx';
import { resultText } from './labels.ts';

/** DMARC per mode: result, record, policy, disposition, and alignment (REQ-MAIL-006). */
export function DmarcDetail({ dmarc }: { dmarc: DmarcResults }) {
  return (
    <section aria-label="DMARC">
      <h2>DMARC</h2>
      <Mode label="RFC 9989" mode={dmarc.rfc9989} />
      <HowChecked method="rfc9989" />
    </section>
  );
}

function Mode({ label, mode }: { label: string; mode: DmarcModeResult }) {
  return (
    <article class="method-result" data-result={mode.result}>
      <h3>
        {label}
        {mode.authorDomain !== undefined && `: ${mode.authorDomain}`}{' '}
        <span class="result">{resultText(mode.result, mode.reason)}</span>
      </h3>
      {mode.record !== undefined && (
        <p>
          Record at _dmarc.{mode.recordAt}: <code>{mode.record}</code>
        </p>
      )}
      {mode.orgDomain !== undefined && (
        <p>
          Organizational domain: {mode.orgDomain} ({mode.orgDomainRule})
        </p>
      )}
      {mode.policy !== undefined && (
        <p>
          Policy: {mode.policy} ({mode.policySource}
          {mode.testing && mode.declaredPolicy !== mode.policy && ', lowered by t=y'})
        </p>
      )}
      {mode.disposition !== undefined && <p>Disposition: {mode.disposition}</p>}
      <FindingList findings={mode.findings} />
      {mode.alignment.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Identifier</th>
              <th>Domain</th>
              <th>Result</th>
              <th>Alignment</th>
              <th>Organizational domain</th>
              <th>Aligned</th>
              <th>Counts</th>
            </tr>
          </thead>
          <tbody>
            {mode.alignment.map((row, i) => (
              <tr key={i}>
                <td>{row.identifier.toUpperCase()}</td>
                <td>{row.domain}</td>
                <td>{resultText(row.authResult)}</td>
                <td>{row.mode}</td>
                <td>{row.orgDomain ?? ''}</td>
                <td>{row.aligned ? 'yes' : 'no'}</td>
                <td>{row.counts ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mode.queryIds.length > 0 && (
        <p>
          DNS queries:{' '}
          {mode.queryIds.map((id, i) => [
            i > 0 && ', ',
            <a key={id} href={`#dns-${id}`}>
              {id}
            </a>,
          ])}
        </p>
      )}
    </article>
  );
}
