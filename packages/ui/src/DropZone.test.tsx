import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropZone } from './DropZone.tsx';

let container: HTMLElement;
afterEach(() => {
  render(null, container);
  container.remove();
});

function mount(onFile: (file: File) => void) {
  container = document.createElement('div');
  document.body.append(container);
  render(
    <DropZone label="Drop a file here, or choose one:" accept=".zip" onFile={onFile} />,
    container,
  );
  return container.querySelector('label.drop') as HTMLLabelElement;
}

const dragEvent = (type: string, files: File[] = []) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  return event;
};

describe('drop zone', () => {
  it('0002: given a chosen file, when the input changes, then onFile gets it', () => {
    const onFile = vi.fn();
    const zone = mount(onFile);
    const input = zone.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toBe('.zip');
    const file = new File(['x'], 'a.zip');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('0002: given a file dragged over, when dropped, then onFile gets it and the zone is no longer active', async () => {
    const onFile = vi.fn();
    const zone = mount(onFile);
    zone.dispatchEvent(dragEvent('dragover'));
    await Promise.resolve();
    expect(zone.dataset.active).toBe('true');
    const file = new File(['x'], 'a.zip');
    zone.dispatchEvent(dragEvent('drop', [file]));
    await Promise.resolve();
    expect(onFile).toHaveBeenCalledWith(file);
    expect(zone.dataset.active).toBe('false');
  });

  it('0002: given the label text, when rendered, then the zone reads it', () => {
    expect(mount(vi.fn()).textContent).toContain('Drop a file here, or choose one:');
  });
});
