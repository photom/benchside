import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cspPolicy, DOH_ORIGINS } from '../../vite.shared.ts';

// Runs against site/, produced by `npm run build`.
const apps = [
  { name: 'home', dir: 'site', base: '/benchside/', connect: [] as string[] },
  { name: 'mail', dir: 'site/mail', base: '/benchside/mail/', connect: DOH_ORIGINS },
  { name: 'zip', dir: 'site/zip', base: '/benchside/zip/', connect: [] as string[] },
  { name: 'pdf', dir: 'site/pdf', base: '/benchside/pdf/', connect: [] as string[] },
];

const decode = (s: string) =>
  s.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

describe.each(apps)('$name app build', ({ dir, base, connect }) => {
  const html = () => readFileSync(join(dir, 'index.html'), 'utf8');

  it('0002: is collected into site/', () => {
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('REQ-MAIL-001, REQ-ZIP-001, REQ-PDF-001: has the expected CSP as the first element in <head>', () => {
    const head = /<head>\s*(<meta[^>]*>)/.exec(html())?.[1] ?? '';
    expect(head).toContain('http-equiv="Content-Security-Policy"');
    expect(decode(/content="([^"]*)"/.exec(head)?.[1] ?? '')).toBe(cspPolicy(connect));
  });

  it('0002: has no inline scripts', () => {
    const scripts = html().match(/<script\b[^>]*>/g) ?? [];
    for (const tag of scripts) expect(tag).toMatch(/\bsrc=/);
  });

  it('0002: loads assets from its own base path', () => {
    for (const [, url] of html().matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (url && !url.startsWith('http') && !/^[a-z]/.test(url))
        expect(url.startsWith(base)).toBe(true);
    }
  });
});

describe.each(['mail', 'zip', 'pdf'])('%s app worker', (app) => {
  const assets = () => readdirSync(`site/${app}/assets`);

  it('0004: the worker is inlined, not emitted as its own script', () => {
    expect(assets().filter((f) => /^worker.*\.js$/.test(f))).toEqual([]);
  });

  it('0004: the worker starts from a blob: URL', () => {
    const js = assets().filter((f) => f.endsWith('.js'));
    const code = js.map((f) => readFileSync(join(`site/${app}/assets`, f), 'utf8')).join('\n');
    expect(code).toContain('createObjectURL');
  });
});
