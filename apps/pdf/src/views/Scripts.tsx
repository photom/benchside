import type { ScriptItem, ScriptSource } from '@benchside/pdf';
import { usePage } from '@benchside/ui';
import { ScriptText } from './ScriptText.tsx';

const KINDS: Record<ScriptSource, string> = {
  '3d': '3D artwork',
  xfa: 'XFA form',
  postscript: 'PostScript XObject',
  unreached: 'Not reached',
  unchecked: 'Not checked',
  removed: 'Removed',
};

/** scripts.md SCR-1 */
const where = (s: ScriptItem) =>
  [
    s.object === undefined ? null : `Object ${s.object}`,
    s.holder === undefined ? null : `3D annotation ${s.holder}`,
    s.page === undefined ? null : `page ${s.page + 1}`,
    s.source === 'xfa' && s.label !== undefined ? `packet "${s.label}"` : null,
    s.source === 'postscript' && s.label !== undefined ? `${s.label} stream` : null,
    s.revision === undefined ? null : `revision ${s.revision}`,
  ]
    .filter(Boolean)
    .join(', ');

const THREE_D: Record<string, string> = {
  PO: 'When its page opens (runs without a click)',
  PV: 'When its page becomes visible (runs without a click)',
};

function when(s: ScriptItem) {
  switch (s.source) {
    case '3d':
      return THREE_D[s.event ?? ''] ?? 'When the 3D annotation is activated';
    case 'xfa':
      return s.event === undefined ? 'Not inside an XFA event' : `XFA event "${s.event}"`;
    case 'postscript':
      return 'Only when printed to a PostScript printer';
    case 'unreached':
      return 'Nothing in the document leads to it';
    case 'unchecked':
      return 'May run: the document walk was cut short before reaching it';
    case 'removed':
      return 'No longer in the newest revision';
  }
}

/** REQ-PDF-006 */
export function Scripts({ scripts }: { scripts: readonly ScriptItem[] }) {
  const [count, more] = usePage(scripts.length);
  return (
    <section aria-label="Scripts">
      <h2>Scripts outside actions</h2>
      {scripts.length === 0 ? (
        <p>None.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Where</th>
              <th>When</th>
              <th>Script</th>
            </tr>
          </thead>
          <tbody>
            {scripts.slice(0, count).map((s, i) => (
              <tr key={i} data-automatic={s.automatic}>
                <td>
                  {KINDS[s.source]} · {s.language || '(language not stated)'}
                </td>
                <td>{where(s)}</td>
                <td>{when(s)}</td>
                <td>{s.script ? <ScriptText script={s.script} /> : '(not readable)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more}
    </section>
  );
}
