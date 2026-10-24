// Parses every ```mermaid block in Markdown files with Mermaid's own parser (0006).
// Usage: node scripts/check-mermaid.ts [files...]  (default: all tracked *.md)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface MermaidError {
  file: string;
  /** Line of the opening ```mermaid fence. */
  line: number;
  message: string;
}

type Mermaid = { parse(text: string): Promise<unknown> };
let mermaid: Promise<Mermaid> | undefined;

/** Mermaid needs a DOM even to parse; provide one from jsdom once. */
function loadMermaid(): Promise<Mermaid> {
  mermaid ??= (async () => {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    Object.assign(globalThis, {
      window,
      document: window.document,
      DOMParser: window.DOMParser,
      Element: window.Element,
    });
    const { default: m } = await import('mermaid');
    m.initialize({ startOnLoad: false });
    return m as Mermaid;
  })();
  return mermaid;
}

export async function checkMarkdown(file: string, text: string): Promise<MermaidError[]> {
  const errors: MermaidError[] = [];
  const fence = /^```mermaid\n([\s\S]*?)^```/gm;
  for (const match of text.matchAll(fence)) {
    const line = text.slice(0, match.index).split('\n').length;
    try {
      await (await loadMermaid()).parse(match[1] ?? '');
    } catch (error) {
      errors.push({
        file,
        line,
        message: String((error as Error).message ?? error).split('\n')[0] ?? '',
      });
    }
  }
  return errors;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const files =
    args.length > 0
      ? args
      : execFileSync(
          'git',
          ['ls-files', '--cached', '--others', '--exclude-standard', '*.md', '**/*.md'],
          { encoding: 'utf8' },
        )
          .split('\n')
          .filter(Boolean);
  let count = 0;
  const errors: MermaidError[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    count += (text.match(/^```mermaid$/gm) ?? []).length;
    errors.push(...(await checkMarkdown(file, text)));
  }
  for (const e of errors) console.error(`${e.file}:${e.line}: ${e.message}`);
  console.log(`${count} diagrams, ${errors.length} failed`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}
