import {
  type ParameterInput,
  resolveParameters,
  SECURITY_CHECKS,
  type TargetFileSystem,
} from '@benchside/zip';
import { CHECK_LABELS, MiB, NUMBER_PARAMETERS, shown, TARGETS } from './labels.ts';

const GROUPS = ['Nested archives', 'Zip bombs', 'Names'] as const;

/** REQ-ZIP-008: parameters for this visit; each change is applied at once. */
export function Options({
  value,
  onChange,
}: {
  value: ParameterInput;
  onChange: (next: ParameterInput) => void;
}) {
  const p = resolveParameters(value);
  return (
    <section aria-label="Options">
      <details class="options">
        <summary>Options</summary>
        {GROUPS.map((group) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            {NUMBER_PARAMETERS.filter((n) => n.group === group).map(({ key, label, unit }) => (
              <label key={key}>
                {label}
                {unit && ` (${unit})`}{' '}
                <input
                  type="number"
                  step="any"
                  value={shown(key, p[key])}
                  // A change event fires on blur or Enter, not on every keystroke.
                  onChange={(e) => {
                    const text = e.currentTarget.value.trim();
                    // PAR-11: an empty field means "use the default", not 0.
                    const n = text === '' ? undefined : Number(text);
                    onChange({ ...value, [key]: n !== undefined && unit === 'MiB' ? n * MiB : n });
                  }}
                />
              </label>
            ))}
            {group === 'Names' && (
              <label>
                Target file system{' '}
                <select
                  value={p.targetFileSystem}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      targetFileSystem: e.currentTarget.value as TargetFileSystem,
                    })
                  }
                >
                  {TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        ))}
        <fieldset>
          <legend>Security checks</legend>
          {SECURITY_CHECKS.map((check) => (
            <label key={check}>
              {CHECK_LABELS[check]}{' '}
              <input
                type="checkbox"
                checked={p.checks[check]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    checks: { ...value.checks, [check]: e.currentTarget.checked },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={() => onChange({})}>
          Reset to defaults
        </button>
      </details>
    </section>
  );
}
