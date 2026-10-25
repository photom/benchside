/** "Header field N, key DNS qN": where a signature and its key are on the page (REQ-MAIL-002). */
export function SourceLinks({
  field,
  keyQueryId,
}: {
  field: number;
  keyQueryId?: string | undefined;
}) {
  return (
    <>
      Header field <a href={`#field-${field + 1}`}>{field + 1}</a>
      {keyQueryId !== undefined && (
        <>
          {', key '}
          <a href={`#dns-${keyQueryId}`}>DNS {keyQueryId}</a>
        </>
      )}
    </>
  );
}
