import type { DetailRow, SourceRow } from '@benchside/dmarc-aggregate';
import { useState } from 'preact/hooks';
import { count } from './format.ts';
import { causeLabel, PATH_NAME } from './labels.ts';

const ROWS = 100;
const DETAILS = 50;
const COLUMNS = 12;

const results = (list: SourceRow['spf']) =>
  list
    .map(
      (r) =>
        `${r.domain}${r.selector ? ` / ${r.selector}` : ''}: ${r.result} (${count(r.messages)})`,
    )
    .join(', ');

/** SRC-1..4 and SRC-6. Expanded rows are kept by IP, so snapshots do not close them (REQ-DMARC-010). */
export function Sources({
  rows,
  host,
}: {
  rows: readonly SourceRow[];
  /** The host name cell (RDNS-5); display only (RDNS-8). */
  host: (ip: string) => string;
}) {
  const [shown, setShown] = useState(ROWS);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (ip: string) => {
    const next = new Set(open);
    if (next.has(ip)) next.delete(ip);
    else next.add(ip);
    setOpen(next);
  };
  return (
    <section>
      <h2>Sources</h2>
      <table>
        <thead>
          <tr>
            <th>Source IP</th>
            <th>Host name</th>
            <th>Messages</th>
            <th>Failing</th>
            <th>Direct / Forwarded / Other</th>
            <th>Main cause</th>
            <th>SPF</th>
            <th>DKIM</th>
            <th>Aligned SPF / DKIM</th>
            <th>Dispositions</th>
            <th>Author domains</th>
            <th>Reporters</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((r) => (
            <SourceRows
              key={r.sourceIp}
              row={r}
              open={open.has(r.sourceIp)}
              onToggle={() => toggle(r.sourceIp)}
              host={host(r.sourceIp)}
            />
          ))}
        </tbody>
      </table>
      {shown < rows.length && (
        <button type="button" onClick={() => setShown(shown + ROWS)}>
          Show more
        </button>
      )}
    </section>
  );
}

function SourceRows({
  row: r,
  open,
  onToggle,
  host,
}: {
  row: SourceRow;
  open: boolean;
  onToggle: () => void;
  host: string;
}) {
  const [shown, setShown] = useState(DETAILS);
  return (
    <>
      <tr class="source">
        <td>
          <button type="button" class="link" aria-expanded={open} onClick={onToggle}>
            {r.sourceIp}
          </button>
        </td>
        <td>{host}</td>
        <td class="num">{count(r.messages)}</td>
        <td class="num">{count(r.failing)}</td>
        <td class="num">
          {count(r.byPath.direct)} / {count(r.byPath.forwarded)} / {count(r.byPath.other)}
        </td>
        <td>{r.mainCause ? causeLabel(r.mainCause) : '—'}</td>
        <td>{results(r.spf)}</td>
        <td>{results(r.dkim)}</td>
        <td class="num">
          {count(r.alignedSpf)} / {count(r.alignedDkim)}
        </td>
        <td>
          {r.byDisposition
            .map((d) => `${d.disposition ?? 'not stated'}: ${count(d.messages)}`)
            .join(', ')}
        </td>
        <td>{r.authorDomains.join(', ')}</td>
        <td>{r.reporters.join(', ')}</td>
      </tr>
      {open && r.details.slice(0, shown).map((d, i) => <Detail key={i} d={d} />)}
      {open && shown < r.details.length && (
        <tr class="detail">
          <td colSpan={COLUMNS}>
            <button type="button" onClick={() => setShown(shown + DETAILS)}>
              Show more details
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

/** One detail row as one line of text (SRC-4). */
function detailText(d: DetailRow): string {
  const c = d.classification;
  const dkim =
    d.dkim.length > 0
      ? d.dkim.map((k) => `${k.domain} / ${k.selector ?? '-'}: ${k.result}`).join(', ')
      : 'none';
  const parts = [
    `${count(d.messages)} messages: From ${d.headerFrom ?? 'not stated'}, envelope ${d.envelopeFrom ?? 'not stated'}`,
    `SPF ${d.spf ? `${d.spf.domain}: ${d.spf.result}` : 'none'}`,
    `DKIM ${dkim}`,
    `aligned SPF ${d.alignedSpf}, DKIM ${d.alignedDkim}`,
    `disposition ${d.disposition ?? 'not stated'}${d.reasons.length > 0 ? `, overrides ${d.reasons.join(', ')}` : ''}`,
  ];
  const why = `${PATH_NAME[c.path]} (${c.pathRule})${c.cause ? `, ${causeLabel(c.cause)} (${c.causeRule})` : ''}`;
  return `${parts.join('; ')}. ${why}. Reporters: ${d.reporters.join(', ')}.`;
}

function Detail({ d }: { d: DetailRow }) {
  return (
    <tr class="detail">
      <td colSpan={COLUMNS}>{detailText(d)}</td>
    </tr>
  );
}
