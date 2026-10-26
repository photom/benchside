import type { Category, Finding } from '@benchside/zip';
import { offset } from './format.ts';

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
}: {
  findings: readonly Finding[];
  onEntry: (index: number) => void;
}) {
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
                  {f.offset !== undefined && <> · offset {offset(f.offset)}</>}
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
