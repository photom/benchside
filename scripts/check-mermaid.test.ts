import { describe, expect, it } from 'vitest';
import { checkMarkdown } from './check-mermaid.ts';

const fence = (body: string) => `# Title\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`;

describe('checkMarkdown', () => {
  it('given a valid diagram, when checked, then there are no errors', async () => {
    expect(await checkMarkdown('a.md', fence('flowchart LR\n  a --> b'))).toEqual([]);
  });

  it('given the labeled two-way edge that broke on GitHub, when checked, then it reports the file and line', async () => {
    const errors = await checkMarkdown('a.md', fence('flowchart LR\n  a <-- label --> b[x@y]'));
    expect(errors).toEqual([expect.objectContaining({ file: 'a.md', line: 3 })]);
  });

  it('given markdown without diagrams, when checked, then there are no errors', async () => {
    expect(await checkMarkdown('a.md', '# Nothing\n\n```ts\nconst x = 1;\n```\n')).toEqual([]);
  });

  it('given two diagrams, when the second is invalid, then only it is reported', async () => {
    const md =
      fence('flowchart LR\n  a --> b') + fence('classDiagram\n  class A {\n    (x) Y\n  }');
    const errors = await checkMarkdown('a.md', md);
    expect(errors.map((e) => e.line)).toEqual([9]);
  });
});
