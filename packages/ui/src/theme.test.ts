import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

/** Custom properties of the first block matching `selector` ... `}`. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}
const light = tokens(
  css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')),
);
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('/* Page */'))) };

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = ['--ink', '--muted', '--accent', '--good-ink', '--warning-ink', '--critical-ink'];
const NON_TEXT = ['--border', '--accent'];

describe('Theme contrast (SITE-4, SITE-5)', () => {
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`SITE-5: given the ${name} theme, when text colors sit on the surfaces, then each reaches 4.5:1`, () => {
      for (const surface of ['--surface', '--surface-raised']) {
        for (const t of TEXT) {
          expect(
            contrast(theme[t] as string, theme[surface] as string),
            `${t} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`SITE-5: given the ${name} theme, when control borders and the focus ring sit on the surface, then each reaches 3:1`, () => {
      for (const t of NON_TEXT) {
        expect(
          contrast(theme[t] as string, theme['--surface'] as string),
          t,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('SITE-4: given the theme, when the system asks for dark, then every surface and text token has a dark value', () => {
    const own = tokens(css.slice(darkStart, css.indexOf('/* Page */')));
    for (const t of [
      '--surface',
      '--surface-raised',
      '--surface-sunken',
      '--line',
      ...TEXT,
      ...NON_TEXT,
    ]) {
      expect(own[t], t).toMatch(/^#/);
    }
  });
});
