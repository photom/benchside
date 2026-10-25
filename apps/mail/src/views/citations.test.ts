import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { citeUrl, REFERENCES, STEPS } from './citations.ts';

/** The tables of docs/reference/mail/citations.md, by section heading. */
function tables(): Map<string, string[][]> {
  // Tests run from the repository root; happy-dom gives import.meta.url a non-file scheme.
  const page = readFileSync('docs/reference/mail/citations.md', 'utf8');
  const result = new Map<string, string[][]>();
  let heading = '';
  for (const line of page.split('\n')) {
    if (line.startsWith('## ')) heading = line.slice(3);
    else if (line.startsWith('| ') && heading && !/^\| (Step|RFC) \|/.test(line)) {
      result.set(heading, [
        ...(result.get(heading) ?? []),
        line
          .slice(2, -2)
          .split(' | ')
          .map((c) => c.trim()),
      ]);
    }
  }
  return result;
}

const HEADINGS = {
  delivery: 'Delivery details',
  spf: 'SPF',
  dkim: 'DKIM',
  rfc9989: 'DMARC (RFC 9989)',
  rfc7489: 'DMARC (RFC 7489)',
  arc: 'ARC',
  receiver: 'Receiver results',
} as const;

describe('citations', () => {
  it('CITE-1: given the citations reference page, when compared, then every method has the same steps, links, and reasons', () => {
    const docs = tables();
    for (const [key, heading] of Object.entries(HEADINGS)) {
      const rows = STEPS[key as keyof typeof HEADINGS].map((s) => [
        s.text,
        s.cites.join(', '),
        s.why,
      ]);
      expect(rows, heading).toEqual(docs.get(heading));
    }
  });

  it('CITE-3: given the References table, when compared, then the list matches in order', () => {
    expect(REFERENCES.map((r) => [`RFC ${r.rfc}`, r.title])).toEqual(tables().get('References'));
  });

  it('CITE-3: given every cited RFC, when looked up, then it is in the References list', () => {
    const listed = new Set(REFERENCES.map((r) => r.rfc));
    for (const steps of Object.values(STEPS)) {
      for (const cite of steps.flatMap((s) => s.cites)) {
        expect(listed.has(Number(/^RFC (\d+)/.exec(cite)?.[1])), cite).toBe(true);
      }
    }
  });

  it('CITE-2: given a section, an appendix, or no section, when linked, then the link points at it on rfc-editor.org', () => {
    expect(citeUrl('RFC 7208 §4.6.4')).toBe('https://www.rfc-editor.org/rfc/rfc7208#section-4.6.4');
    expect(citeUrl('RFC 9989 Appendix A.4')).toBe(
      'https://www.rfc-editor.org/rfc/rfc9989#appendix-A.4',
    );
    expect(citeUrl('RFC 8463')).toBe('https://www.rfc-editor.org/rfc/rfc8463');
  });
});
