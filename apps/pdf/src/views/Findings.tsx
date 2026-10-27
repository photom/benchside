import type { Finding } from '@benchside/pdf';
import { offset } from '@benchside/ui';

const SEVERITY = { error: 'Error', warning: 'Warning', info: 'Info' } as const;

export function Findings({ findings }: { findings: readonly Finding[] }) {
  return (
    <section aria-label="Findings">
      <h2>Findings</h2>
      {findings.length === 0 ? (
        <p>No findings.</p>
      ) : (
        <ul>
          {findings.map((f, i) => (
            <li key={i} class="finding" data-severity={f.severity}>
              <strong>{SEVERITY[f.severity]}</strong> {f.message} <code>{f.id}</code>
              {f.clause && <> · ISO 32000-1 {f.clause}</>}
              {f.offset !== undefined && <> · offset {offset(f.offset)}</>}
              {f.object !== undefined && <> · object {f.object}</>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
