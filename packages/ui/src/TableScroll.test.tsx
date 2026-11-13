import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { TableScroll } from './TableScroll.tsx';

let container: HTMLElement;
afterEach(() => {
  render(null, container);
  container.remove();
});

describe('Table scroll area (SITE-9)', () => {
  it('SITE-9: given a table that fits (no layout, as in happy-dom), when wrapped, then the area is neither a region nor a tab stop', () => {
    container = document.createElement('div');
    document.body.append(container);
    render(
      <TableScroll label="Sources">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>,
      container,
    );
    const area = container.querySelector('.table-scroll') as HTMLElement;
    expect(area.querySelector('table')).not.toBeNull();
    expect(area.getAttribute('role')).toBeNull();
    expect(area.hasAttribute('tabindex')).toBe(false);
  });
});
