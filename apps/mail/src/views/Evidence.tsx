import type { Evidence } from '@benchside/mail';

/** In-page links to what a finding is based on (REQ-MAIL-002). */
export function EvidenceLinks({ evidence }: { evidence: readonly Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <span class="evidence">
      {' '}
      ({evidence.map((e, i) => [i > 0 && ', ', <EvidenceLink key={i} evidence={e} />])})
    </span>
  );
}

function EvidenceLink({ evidence }: { evidence: Evidence }) {
  switch (evidence.kind) {
    case 'header':
      return <a href={`#field-${evidence.index + 1}`}>header field {evidence.index + 1}</a>;
    case 'dns':
      return <a href={`#dns-${evidence.queryId}`}>DNS {evidence.queryId}</a>;
    case 'bytes':
      return (
        <span>
          bytes {evidence.range.start}–{evidence.range.end}
        </span>
      );
  }
}
