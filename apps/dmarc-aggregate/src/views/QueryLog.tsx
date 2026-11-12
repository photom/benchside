import type { LookupState } from '../state.ts';

/** RDNS-7: every query, its rcode, and whether it came from the cache; the budget finding with it (PRG-12). */
export function QueryLog({ lookup }: { lookup: LookupState }) {
  if (lookup.log.length === 0 && lookup.findings.length === 0) return null;
  return (
    <section>
      <h2>Query log</h2>
      {lookup.findings.map((f, i) => (
        <p key={i} class="error">
          <code>{f.id}</code>: {f.message}
        </p>
      ))}
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Type</th>
            <th>Result</th>
            <th>Cache</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {lookup.log.map((e) => (
            <tr key={e.queryId}>
              <td>{e.queryId}</td>
              <td>{e.name}</td>
              <td>{e.type}</td>
              <td>
                {e.rcode}
                {e.records.length > 0 && `: ${e.records.join(', ')}`}
              </td>
              <td>{e.cacheHit ? 'cached' : ''}</td>
              <td>{e.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
