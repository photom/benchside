import type { ZipReport } from '@benchside/zip';
import { offset } from './format.ts';

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
    </section>
  );
}
