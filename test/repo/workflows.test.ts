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
const psl = workflows.find((w) => w.f === 'psl.yml')?.text ?? '';
const fromMain =
  "if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'";

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

  it('0002, 0019: deploys site/ to GitHub Pages only from main, on push or dispatch, with page-scoped permissions', () => {
    const deploy = ci.slice(ci.indexOf('\n  deploy:'));
    expect(deploy).toContain(fromMain);
    const uploadAt = ci.indexOf('actions/upload-pages-artifact');
    expect(uploadAt, 'upload-pages-artifact step').toBeGreaterThan(-1);
    const upload = ci.slice(uploadAt, ci.indexOf('\n  deploy:'));
    expect(upload).toContain(fromMain);
    expect(deploy).toMatch(/pages: write/);
    expect(deploy).toMatch(/id-token: write/);
    expect(ci).toContain('path: site');
  });

  describe('0019: the PSL workflow merges its own pull request', () => {
    const at = (needle: string) => {
      const i = psl.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };

    it('watches the CI run on the commit it pushed and stops if CI fails', () => {
      expect(psl).toMatch(
        /gh run list --workflow ci\.yml --branch "\$branch" --event workflow_dispatch/,
      );
      expect(psl).toMatch(/headSha/);
      expect(psl).toMatch(/timeout \d+m gh run watch "\$run_id" --exit-status/);
    });

    it('merges only the commit CI checked, after CI passed', () => {
      expect(psl).toMatch(
        /gh pr merge "\$branch" --repo "\$GITHUB_REPOSITORY" --squash --delete-branch --match-head-commit "\$sha"/,
      );
      expect(psl).not.toContain('git switch --quiet --detach');
      expect(at('gh run watch')).toBeLessThan(at('gh pr merge'));
      expect(at('gh pr create')).toBeLessThan(at('gh pr merge'));
    });

    it('then starts CI on main, because a GITHUB_TOKEN merge starts no push run', () => {
      expect(at('gh pr merge')).toBeLessThan(at('gh workflow run ci.yml --ref main'));
    });

    it('resumes its own open pull request; stops only for one merged or closed', () => {
      expect(psl).toMatch(/if \[ "\$state" = DONE \]; then/);
      expect(psl).toMatch(/if \[ -z "\$state" \]; then\n\s+gh pr create/);
    });

    it('says what to do on every failure after the pull request exists', () => {
      const tail = psl.slice(at('gh pr create'));
      for (const step of ['gh run watch', 'gh pr merge']) {
        const line = tail.slice(tail.indexOf(step)).split('\n').slice(0, 3).join('\n');
        expect(line, step).toContain('::error::');
      }
    });

    it('has a time limit, so a stuck CI run cannot hold the job for six hours', () => {
      expect(psl).toMatch(/timeout-minutes: \d+/);
    });
  });
});
