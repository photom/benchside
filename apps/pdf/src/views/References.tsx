/** REQ-PDF-002: where the cited clauses come from. */
export function References() {
  return (
    <section aria-label="References">
      <h2>References</h2>
      <p>
        Clause numbers refer to{' '}
        <a
          href="https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf"
          rel="noreferrer"
        >
          ISO 32000-1:2008
        </a>{' '}
        (PDF 1.7, the copy published by Adobe). PNG predictors follow{' '}
        <a href="https://www.rfc-editor.org/rfc/rfc2083" rel="noreferrer">
          RFC 2083
        </a>
        , section 6.
      </p>
    </section>
  );
}
