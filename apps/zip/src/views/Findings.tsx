import type { Category, Finding } from '@benchside/zip';
import { offset } from './format.ts';
import type { HexTarget } from './HexView.tsx';

const SEVERITY = { error: 'Error', warning: 'Warning', info: 'Info' } as const;

// REP-10: the order answers "should I worry?" first.
const GROUPS: readonly { category: Category; title: string }[] = [
  { category: 'security', title: 'Security' },
  { category: 'disagreement', title: 'Reader disagreement' },
  { category: 'structure', title: 'Structure' },
];

export function Findings({
  findings,
  onEntry,
  targetOf,
  onBytes,
}: {
  findings: readonly Finding[];
  onEntry: (index: number) => void;
  /** HEX-1: the region to show for a finding, or null when no region holds its offset. */
  targetOf: (finding: Finding) => HexTarget | null;
  onBytes: (target: HexTarget) => void;
}) {
  const Offset = ({ finding, at }: { finding: Finding; at: number }) => {
    const target = targetOf(finding);
    if (!target) return <> · offset {offset(at)}</>;
    return (
      <>
        {' · '}
        <button type="button" onClick={() => onBytes(target)}>
          Bytes at {offset(at)}
        </button>
      </>
    );
  };
  return (
    <section aria-label="Findings">
      <h2>Findings</h2>
      {findings.length === 0 && <p>No findings.</p>}
      {GROUPS.map(({ category, title }) => {
        const list = findings.filter((f) => f.category === category);
        if (list.length === 0) return null;
        return (
          <section key={category} aria-label={title}>
            <h3>{`${title} (${list.length})`}</h3>
            <ul>
              {list.map((f, i) => (
                <li key={i} class="finding" data-severity={f.severity}>
                  <strong>{SEVERITY[f.severity]}</strong> {f.message} <code>{f.id}</code>
                  {f.section && <> · APPNOTE {f.section}</>}
                  {f.offset !== undefined && <Offset finding={f} at={f.offset} />}
                  {f.entry !== undefined && (
                    <>
                      {' · '}
                      <button type="button" onClick={() => onEntry(f.entry as number)}>
                        Entry {f.entry}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
