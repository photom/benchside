import type { DomainEnforcement } from '@benchside/dmarc-aggregate';
import { TableScroll } from '@benchside/ui';
import { count, day, percent, stated } from './format.ts';
import { causeLabel, PATH_NAME, STATUS } from './labels.ts';

/** ENF-1..7 for each policy domain in the filtered set. */
export function Enforcement({ domains }: { domains: readonly DomainEnforcement[] }) {
  return (
    <section>
      <h2>Enforcement</h2>
      {domains.map((d) => {
        const s = STATUS[d.status];
        const p = d.policy;
        return (
          <article key={d.domain}>
            <h3>{d.domain}</h3>
            {p && (
              <p>
                <code>
                  p={stated(p.p)} sp={stated(p.sp)} np={stated(p.np)} pct={stated(p.pct)} testing=
                  {stated(p.testing)}
                </code>
              </p>
            )}
            <p class="status-line" data-tone={s.tone}>
              <span aria-hidden="true">{s.icon}</span> {s.label}
            </p>
            <p class="note">
              {d.period
                ? `From ${day(d.period.begin)} to ${day(d.period.end)}`
                : 'No dated reports'}
              . It can take many months of reports to be sure (RFC 9989 §5.1.7).
            </p>
            <TableScroll label="Failing messages by path">
              <table>
                <caption>Failing messages by path</caption>
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Quarantined or rejected</th>
                    <th>Not yet acted on</th>
                    <th>Share of the path</th>
                  </tr>
                </thead>
                <tbody>
                  {d.failing.map((f) => (
                    <tr key={f.path}>
                      <td>{PATH_NAME[f.path]}</td>
                      <td class="num">{count(f.acted)}</td>
                      <td class="num">{count(f.notActed)}</td>
                      <td class="num">{percent(f.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {d.directSources.length > 0 && (
              <TableScroll label="Failing direct sources">
                <table>
                  <caption>Failing direct sources</caption>
                  <thead>
                    <tr>
                      <th>Source IP</th>
                      <th>Failing messages</th>
                      <th>Cause</th>
                      <th>SPF domains</th>
                      <th>DKIM domains</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.directSources.map((x) => (
                      <tr key={x.sourceIp}>
                        <td>{x.sourceIp}</td>
                        <td class="num">{count(x.messages)}</td>
                        <td class="cause">{x.cause ? causeLabel(x.cause) : '—'}</td>
                        <td>{x.spfDomains.join(', ')}</td>
                        <td>{x.dkimDomains.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            {d.spfOnly.messages > 0 && (
              <p>
                SPF-only passes: {count(d.spfOnly.messages)} messages ({percent(d.spfOnly.share)} of
                passing mail) from {d.spfOnly.sources.map((x) => x.sourceIp).join(', ')}.
              </p>
            )}
            {d.overrides.length > 0 && (
              <TableScroll label="Receiver overrides">
                <table>
                  <caption>Receiver overrides</caption>
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th>Failing messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.overrides.map((o) => (
                      <tr key={o.type ?? ''}>
                        <td>{o.type ?? 'No reason'}</td>
                        <td class="num">{count(o.messages)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </article>
        );
      })}
    </section>
  );
}
