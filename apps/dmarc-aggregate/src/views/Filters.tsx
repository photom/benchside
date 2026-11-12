import type { Filters as FilterSet, Focus, ReportSummary } from '@benchside/dmarc-aggregate';
import { causeLabel, PATH_NAME } from './labels.ts';

/** Domains, reporters (first spelling, CMB-5), and days of the counted reports. */
function choices(reports: readonly ReportSummary[]) {
  const domains = new Set<string>();
  const reporters = new Map<string, string>();
  const days = new Set<string>();
  for (const r of reports) {
    if (r.status !== 'counted') continue;
    domains.add(r.policyDomain);
    if (!reporters.has(r.reporter.toLowerCase()))
      reporters.set(r.reporter.toLowerCase(), r.reporter);
    if (r.day) days.add(r.day);
  }
  return {
    domains: [...domains].sort(),
    reporters: [...reporters.values()],
    days: [...days].sort(),
  };
}

/** One row of filters above everything they change (CMB-6, SRC-5; ui.md, Interaction). */
export function Filters({
  reports,
  filters,
  focus,
  onChange,
}: {
  reports: readonly ReportSummary[];
  filters: FilterSet;
  focus: Focus | null;
  onChange: (filters: FilterSet, focus: Focus | null) => void;
}) {
  const c = choices(reports);
  const ticked = (name: string) =>
    filters.reporters === null ||
    filters.reporters.some((r) => r.toLowerCase() === name.toLowerCase());
  const setDays = (from: string, to: string) => {
    if (!from && !to) {
      onChange({ ...filters, days: null }, focus);
      return;
    }
    const a = from || (c.days[0] ?? '');
    const b = to || (c.days[c.days.length - 1] ?? '');
    // A range always runs forward: a From after the To swaps them.
    onChange({ ...filters, days: a <= b ? { from: a, to: b } : { from: b, to: a } }, focus);
  };
  return (
    <section aria-label="Filters" class="filters">
      <label>
        Policy domain{' '}
        <select
          value={filters.domain ?? ''}
          onChange={(e) => onChange({ ...filters, domain: e.currentTarget.value || null }, focus)}
        >
          <option value="">All</option>
          {c.domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Reporters</legend>
        {c.reporters.map((name) => (
          <label key={name}>
            <input
              type="checkbox"
              checked={ticked(name)}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                const list = c.reporters.filter((r) => (r === name ? on : ticked(r)));
                onChange(
                  { ...filters, reporters: list.length === c.reporters.length ? null : list },
                  focus,
                );
              }}
            />
            {name}
          </label>
        ))}
      </fieldset>
      <label>
        From{' '}
        <select
          value={filters.days?.from ?? ''}
          onChange={(e) => setDays(e.currentTarget.value, filters.days?.to ?? '')}
        >
          <option value="">First day</option>
          {c.days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label>
        To{' '}
        <select
          value={filters.days?.to ?? ''}
          onChange={(e) => setDays(filters.days?.from ?? '', e.currentTarget.value)}
        >
          <option value="">Last day</option>
          {c.days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      {focus && (
        <span class="chip">
          Focus: {'path' in focus ? PATH_NAME[focus.path] : causeLabel(focus.cause)}{' '}
          <button type="button" onClick={() => onChange(filters, null)}>
            Clear focus
          </button>
        </span>
      )}
    </section>
  );
}
