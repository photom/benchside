import type { Script } from '@benchside/pdf';
import { shown } from './text.ts';

/** A script as preformatted text in a closed block; never run or rendered. */
export function ScriptText({ script }: { script: Script }) {
  return (
    <details>
      <summary>Script, {script.byteLength} bytes</summary>
      <pre>{shown(script.text)}</pre>
    </details>
  );
}
