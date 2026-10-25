import type { Envelope, EnvelopeValue } from '@benchside/mail';
import { HowChecked } from './HowChecked.tsx';
import { SourceLinks } from './SourceLinks.tsx';

/** The SMTP values SPF uses, each with where it came from (REQ-MAIL-009, ENV-15). */
export function DeliveryDetails({ envelope }: { envelope: Envelope }) {
  return (
    <section aria-label="Delivery details">
      <h2>Delivery details</h2>
      <table>
        <tbody>
          <Row label="Client IP" value={envelope.clientIp} />
          <Row label="HELO" value={envelope.helo} />
          <Row label="MAIL FROM" value={envelope.mailFrom} />
        </tbody>
      </table>
      <HowChecked method="delivery" />
    </section>
  );
}

function Row({ label, value }: { label: string; value: EnvelopeValue | undefined }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{value === undefined ? 'Not found' : value.value || '<> (null reverse-path)'}</td>
      <td>
        {value?.source === 'user' && 'Entered by you'}
        {value !== undefined && value.source !== 'user' && (
          <>
            <SourceLinks field={value.source.field} /> ({value.source.rule})
          </>
        )}
      </td>
    </tr>
  );
}
