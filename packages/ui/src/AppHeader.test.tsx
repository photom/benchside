import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { AppHeader } from './AppHeader.tsx';

let container: HTMLElement;
afterEach(() => {
  render(null, container);
  container.remove();
});

function mount(node: preact.ComponentChild) {
  container = document.createElement('div');
  document.body.append(container);
  render(node, container);
  return container.querySelector('header.app-header') as HTMLElement;
}

describe('Site header (SITE-1)', () => {
  it('SITE-1: given a tool, when shown, then a link home, the title as the only h1, and the privacy line', () => {
    const header = mount(
      <AppHeader title="ZIP analyzer" privacy="Your file stays in this browser." />,
    );
    const home = header.querySelector('a.home') as HTMLAnchorElement;
    expect(home.getAttribute('href')).toBe('../');
    expect(home.textContent).toBe('benchside');
    expect([...header.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['ZIP analyzer']);
    expect(header.querySelector('.privacy')?.textContent).toBe('Your file stays in this browser.');
  });

  it('SITE-1: given extra lines, when shown, then they follow the privacy line inside the header', () => {
    const header = mount(
      <AppHeader title="T" privacy="P">
        <p class="scope">Scope</p>
      </AppHeader>,
    );
    expect([...header.querySelectorAll('p')].map((p) => p.className)).toEqual(['privacy', 'scope']);
  });
});
