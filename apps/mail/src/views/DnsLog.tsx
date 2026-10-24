import type { DnsLogEntry } from '@benchside/mail';

/** Every DNS query of the analysis (DNS-15); rows are evidence targets (id dns-qN). */
export function DnsLog({ entries }: { entries: readonly DnsLogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-label="DNS log">
      <h2>DNS queries</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Type</th>
            <th>Result</th>
            <th>DNSSEC</th>
            <th>Cache</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.queryId} id={`dns-${e.queryId}`}>
              <td>{e.queryId}</td>
              <td>{e.name}</td>
              <td>{e.type}</td>
              <td>{e.rcode}</td>
              <td>{dnssec(e)}</td>
              <td>{e.cacheHit ? 'cache hit' : ''}</td>
              <td>{e.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** DNS-8: the AD flag only means something when an answer arrived. */
function dnssec(e: DnsLogEntry): string {
  if (e.rcode !== 'NOERROR' && e.rcode !== 'NXDOMAIN') return 'n/a';
  return e.authenticated ? 'authenticated' : 'not authenticated';
}
