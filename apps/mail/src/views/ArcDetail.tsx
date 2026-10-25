import type { ArcReport, ArcSetTrace, ArcSignatureTrace } from '@benchside/mail';
import { FindingList } from './Findings.tsx';
import { entryText, resultText } from './labels.ts';
import { SourceLinks } from './SourceLinks.tsx';

/** The ARC chain: result, oldest pass, findings, and one row per hop (REQ-MAIL-007, ARC-10). */
export function ArcDetail({ arc }: { arc: ArcReport }) {
  if (arc.result === 'none') return null;
  return (
    <section aria-label="ARC" class="method-result" data-result={arc.result}>
      <h2>
        ARC <span class="result">{resultText(arc.result, arc.reason)}</span>
      </h2>
      {arc.oldestPass !== undefined && (
        <p>
          {arc.oldestPass === 0
            ? "Every hop's message signature still verifies."
            : `The oldest hop whose message signature still verifies is hop ${arc.oldestPass}.`}
        </p>
      )}
      <FindingList findings={arc.findings} />
      {arc.sets.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Hop</th>
              <th>Sealed by</th>
              <th>Time</th>
              <th>cv</th>
              <th>Message signature</th>
              <th>Seal</th>
              <th>Results at this hop</th>
            </tr>
          </thead>
          <tbody>
            {arc.sets.map((set) => (
              <Hop key={set.instance} set={set} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Hop({ set }: { set: ArcSetTrace }) {
  const { seal, ams, aar } = set;
  // Without a seal (ARC-3), the hop's message signature still names the signer.
  const signer = seal ?? ams;
  return (
    <tr>
      <td>{set.instance}</td>
      <td>{signer ? `d=${signer.d ?? '?'} s=${signer.s ?? '?'}` : '?'}</td>
      <td>{sealTime(signer?.t)}</td>
      <td>{seal?.cv ?? ''}</td>
      <td>
        <Signature trace={ams} />
      </td>
      <td>
        <Signature trace={seal} />
      </td>
      <td>
        {aar && (
          <>
            {aar.authservId || '(no authserv-id)'}:{' '}
            {aar.entries.length > 0 ? aar.entries.map(entryText).join('; ') : '(no results)'}{' '}
            <SourceLinks field={aar.field} />
          </>
        )}
      </td>
    </tr>
  );
}

function Signature({ trace }: { trace: ArcSignatureTrace | undefined }) {
  if (!trace) return <>missing</>;
  return (
    <>
      {resultText(trace.result, trace.reason)}{' '}
      <SourceLinks field={trace.field} keyQueryId={trace.keyQueryId} />
    </>
  );
}

/** `t=` as UTC, e.g. "2026-09-21 14:13:20 UTC"; as written when it is not a usable number. */
function sealTime(t: string | undefined): string {
  if (t === undefined) return '';
  // Only plain decimal seconds: Number() would also read "", "0x6A", or "1e9".
  if (!/^\d{1,12}$/.test(t)) return t;
  const ms = Number(t) * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return t;
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
