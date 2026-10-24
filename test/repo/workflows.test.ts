import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = '.github/workflows';
const workflows = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }))
  : [];
const ci = workflows.find((w) => w.f === 'ci.yml')?.text ?? '';

describe('GitHub Actions workflows', () => {
  it('0006: a CI workflow exists', () => {
    expect(ci).not.toBe('');
  });

  it('0006: every action is pinned to a full commit SHA', () => {
    for (const { f, text } of workflows) {
      for (const [, ref] of text.matchAll(/uses:\s*(\S+)/g)) {
        expect(ref, `${f}: ${ref}`).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/);
      }
    }
  });

  it('best practices: default permissions are read-only', () => {
    for (const { f, text } of workflows) {
      expect(text, f).toMatch(/^permissions:\n\s+contents: read$/m);
    }
  });

  it('0002: CI runs every check before building', () => {
    for (const step of [
      'npm ci',
      'npm run typecheck',
      'npm run lint',
      'npm run docs:check',
      'npm test',
      'npm run build',
      'npm run test:build',
      'npm run test:browser',
    ]) {
      expect(ci).toContain(step);
    }
  });

  it('0002: deploys site/ to GitHub Pages only from main, with page-scoped permissions', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(deploy).toMatch(/pages: write/);
    expect(deploy).toMatch(/id-token: write/);
    expect(ci).toContain('path: site');
  });
});
