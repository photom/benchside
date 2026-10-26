import type { ZipReport } from '@benchside/zip';
import { Fragment } from 'preact';
import { offset } from './format.ts';
import { CHECK_LABELS, NUMBER_PARAMETERS, shown, TARGETS } from './labels.ts';

export function Summary({ report }: { report: ZipReport }) {
  const end = report.end;
  return (
    <section aria-label="Summary">
      <h2>Summary</h2>
      <dl>
        <dt>Size</dt>
        <dd>{report.byteLength} bytes</dd>
        <dt>Entries</dt>
        <dd>
          {report.entries.length}
          {end && end.entryCount !== report.entries.length && ` of ${end.entryCount} declared`}
        </dd>
        {end && (
          <>
            <dt>ZIP64</dt>
            <dd>{end.zip64 ? 'Yes' : 'No'}</dd>
            <dt>Central directory</dt>
            <dd>
              {offset(end.cdOffset + end.shift)}, {end.cdByteLength} bytes
            </dd>
            {end.shift !== 0 && (
              <>
                <dt>Shift</dt>
                <dd>{end.shift} bytes</dd>
              </>
            )}
            {end.comment.text !== '' && (
              <>
                <dt>Comment</dt>
                <dd>
                  <pre>{end.comment.text}</pre>
                  {end.comment.encoding === 'utf-8' ? 'UTF-8' : 'Code Page 437'}
                  {end.comment.guessed && ' (guessed)'}
                </dd>
              </>
            )}
          </>
        )}
      </dl>
      <ParametersUsed report={report} />
    </section>
  );
}

/** PAR-12: the values this report was made with. */
function ParametersUsed({ report }: { report: ZipReport }) {
  const p = report.parameters;
  const off = Object.entries(p.checks)
    .filter(([, on]) => !on)
    .map(([check]) => CHECK_LABELS[check as keyof typeof CHECK_LABELS]);
  return (
    <details>
      <summary>Parameters used</summary>
      <dl>
        {NUMBER_PARAMETERS.map(({ key, label, unit }) => (
          <Fragment key={key}>
            <dt>{label}</dt>
            <dd>
              {shown(key, p[key])}
              {unit && ` ${unit}`}
            </dd>
          </Fragment>
        ))}
        <dt>Target file system</dt>
        <dd>{TARGETS.find((t) => t.value === p.targetFileSystem)?.label}</dd>
        <dt>Checks turned off</dt>
        <dd>{off.length === 0 ? 'None' : off.join(', ')}</dd>
      </dl>
    </details>
  );
}
