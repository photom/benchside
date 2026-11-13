import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '@benchside/ui/theme.css';
import '../../apps/dmarc-aggregate/src/style.css';
import { Input } from '../../apps/dmarc-aggregate/src/views/Input.tsx';

describe('Keyboard focus (SITE-6)', () => {
  it('SITE-6: given the DMARC drop zone, when Tab is pressed, then the Add files picker takes focus and its label shows a 2 px ring', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(h(Input, { onAdd: () => {}, onClear: () => {}, onError: () => {} }), root);
    await userEvent.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.matches('input[type=file]')).toBe(true);
    const label = focused.closest('label.button') as HTMLElement;
    expect(label.textContent).toContain('Add files');
    const ring = getComputedStyle(label);
    expect(ring.outlineStyle).toBe('solid');
    expect(ring.outlineWidth).toBe('2px');
    render(null, root);
    root.remove();
  });
});
