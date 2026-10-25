import { type CitedMethod, citeUrl, REFERENCES, STEPS } from './citations.ts';

/** REQ-MAIL-014: a method's steps, each with its RFC links and reason (CITE-1, CITE-2). */
export function HowChecked({ method }: { method: CitedMethod }) {
  return (
    <details data-part="steps">
      <summary>How this is checked</summary>
      <ol>
        {STEPS[method].map((step) => (
          <li key={step.text}>
            {step.text} (
            {step.cites.map((cite, i) => [i > 0 && ', ', <RfcLink key={cite} cite={cite} />])}):{' '}
            {step.why}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** CITE-3: every RFC the analyzer follows. */
export function References() {
  return (
    <section aria-label="References">
      <h2>References</h2>
      <ul>
        {REFERENCES.map((r) => (
          <li key={r.rfc}>
            <RfcLink cite={`RFC ${r.rfc}`} />: {r.title}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** CITE-4: navigation only, in a new tab, without a referrer. */
function RfcLink({ cite }: { cite: string }) {
  return (
    <a href={citeUrl(cite)} target="_blank" rel="noreferrer">
      {cite}
    </a>
  );
}
