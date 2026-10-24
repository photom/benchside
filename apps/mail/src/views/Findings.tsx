import type { Finding } from '@benchside/mail';
import { EvidenceLinks } from './Evidence.tsx';
import { SEVERITY_LABEL } from './labels.ts';

/** The one way findings are shown: severity, message, and evidence links (REQ-MAIL-002). */
export function FindingList({ findings }: { findings: readonly Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul class="findings">
      {findings.map((f, i) => (
        <li key={i}>
          <strong>{SEVERITY_LABEL[f.severity]}:</strong> {f.message}
          <EvidenceLinks evidence={f.evidence} />
        </li>
      ))}
    </ul>
  );
}
