import type { DmarcMode, DmarcModeResult, DmarcResults } from '@benchside/mail';
import { FindingList } from './Findings.tsx';
import { HowChecked } from './HowChecked.tsx';
import { resultText } from './labels.ts';

const SECTIONS: Record<DmarcMode, { label: string; title: string }> = {
  rfc9989: { label: 'DMARC (RFC 9989)', title: 'DMARC (RFC 9989, DMARCbis)' },
  rfc7489: { label: 'DMARC (RFC 7489)', title: 'DMARC (RFC 7489, DMARC1)' },
};

/** One section per evaluated mode: result, record, policy, disposition, and alignment (REQ-MAIL-006). */
export function DmarcDetail({ dmarc }: { dmarc: DmarcResults }) {
  return (
    <>
      {(['rfc9989', 'rfc7489'] as const).map((key) => {
        const mode = dmarc[key];
        if (!mode) return null;
        return (
          <section key={key} aria-label={SECTIONS[key].label}>
            <h2>{SECTIONS[key].title}</h2>
            <Mode mode={mode} />
            <HowChecked method={key} />
          </section>
        );
      })}
    </>
  );
}

function Mode({ mode }: { mode: DmarcModeResult }) {
  return (
    <article class="method-result" data-result={mode.result}>
      <h3>
        {mode.authorDomain ?? 'No author domain'}{' '}
        <span class="result">{resultText(mode.result, mode.reason)}</span>
      </h3>
      {mode.perDomain && (
        // DMARC-3: the mode result above comes from the deciding domain.
        <ul data-part="per-domain">
          {mode.perDomain.map((d) => (
            <li key={d.authorDomain}>
              {d.authorDomain}: {resultText(d.result, d.reason)}
              {d.policy !== undefined && ` (policy ${d.policy})`}
            </li>
          ))}
        </ul>
      )}
      {mode.record !== undefined && (
        <p>
          Record at _dmarc.{mode.recordAt}: <code>{mode.record}</code>
        </p>
      )}
      {mode.orgDomain !== undefined && (
        <p>
          Organizational domain: {mode.orgDomain} ({mode.orgDomainRule}
          {mode.pslVersion !== undefined && `; list ${mode.pslVersion}`})
        </p>
      )}
      {mode.policy !== undefined && (
        <p>
          Policy: {mode.policy} ({mode.policySource}
          {mode.testing && mode.declaredPolicy !== mode.policy && ', lowered by t=y'})
        </p>
      )}
      {mode.disposition !== undefined && (
        <p>
          Disposition:{' '}
          {mode.dispositions
            ? mode.dispositions.map((d) => `${d.disposition} (${d.weight}%)`).join(', ')
            : mode.disposition}
        </p>
      )}
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
