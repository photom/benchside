import type { PartialReport } from '@benchside/mail';
import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { App } from '../../apps/mail/src/App.tsx';
import '../../apps/mail/src/style.css';

const box = (selector: string) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element.getBoundingClientRect();
};

describe('mail app layout', () => {
  it('REQ-MAIL-002: given the page, when laid out, then the heading, drop zone, and options do not overlap', () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(h(App, { host: { analyze: () => new Promise<PartialReport>(() => {}) } }), root);
    const heading = box('h1');
    const drop = box('.drop');
    const options = box('[aria-label="Options"]');
    expect(drop.top).toBeGreaterThanOrEqual(heading.bottom);
    expect(options.top).toBeGreaterThanOrEqual(drop.bottom);
    render(null, root);
    root.remove();
  });
});
