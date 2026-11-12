import type { LookupProvider } from '@benchside/dmarc-aggregate';
import type { LookupState } from '../state.ts';

const PROVIDER_NAME: Record<LookupProvider, string> = {
  cloudflare: 'Cloudflare',
  google: 'Google',
};

/** RDNS-1: off by default; the label names the provider and what is sent (ui.md, Interaction). */
export function Lookup({
  lookup,
  onChange,
}: {
  lookup: LookupState;
  onChange: (on: boolean, provider: LookupProvider) => void;
}) {
  return (
    <div class="lookup">
      <label>
        <input
          type="checkbox"
          checked={lookup.on}
          onChange={(e) => onChange(e.currentTarget.checked, lookup.provider)}
        />
        Look up host names. Sends source IP addresses to {PROVIDER_NAME[lookup.provider]} as reverse
        DNS names
      </label>{' '}
      <label>
        Provider{' '}
        <select
          value={lookup.provider}
          onChange={(e) => onChange(lookup.on, e.currentTarget.value as LookupProvider)}
        >
          <option value="cloudflare">Cloudflare</option>
          <option value="google">Google</option>
        </select>
      </label>
    </div>
  );
}
