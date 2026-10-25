import type { ComponentChildren } from 'preact';

/**
 * REQ-MAIL-013: a header value as written. Each fold starts a new line; its indent
 * and every other tab show as markers, because spaces and tabs look alike.
 */
export function FieldValue({ value }: { value: string }) {
  const lines = value.split('\r\n');
  return (
    <pre class="field-value">
      {lines.map((line, n) => {
        const indent = n === 0 ? '' : (/^[ \t]*/.exec(line)?.[0] ?? '');
        return [
          n > 0 && '\n',
          ...[...indent].map((c) => marker(c)),
          ...withTabs(line.slice(indent.length)),
        ];
      })}
    </pre>
  );
}

function withTabs(text: string): ComponentChildren[] {
  return text.split('\t').flatMap((part, i) => (i === 0 ? [part] : [marker('\t'), part]));
}

function marker(c: string) {
  const tab = c === '\t';
  return (
    <span class="ws" role="img" aria-label={tab ? 'tab' : 'space'}>
      {tab ? '<TAB>' : '<SP>'}
    </span>
  );
}
