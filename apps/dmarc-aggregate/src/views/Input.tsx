import { useState } from 'preact/hooks';
import { fromDrop, fromFolderPicker, fromPicker, type Picked } from '../input/collect.ts';

/** The drop area, the two pickers, and Clear (ui.md, Input). */
export function Input({
  onAdd,
  onClear,
  onError,
}: {
  onAdd: (files: Picked[]) => void;
  onClear: () => void;
  /** A dropped folder or file the browser would not give us. */
  onError: (message: string) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <section
      aria-label="Add reports"
      class="drop"
      data-active={active}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        const items = e.dataTransfer?.items;
        if (!items) return;
        fromDrop(items).then(
          (files) => files.length > 0 && onAdd(files),
          (error: unknown) => onError(`The drop could not be read: ${String(error)}`),
        );
      }}
    >
      <p>
        Drop files or folders here. XML, .gz, .zip, .tar, .tar.gz, or a folder of them. Aggregate
        reports only.
      </p>
      <label class="button">
        Add files
        <input
          type="file"
          multiple
          onChange={(e) => {
            const files = fromPicker(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length > 0) onAdd(files);
          }}
        />
      </label>
      <label class="button">
        Add folder
        <input
          type="file"
          // @ts-expect-error webkitdirectory is not in Preact's attribute types
          webkitdirectory=""
          onChange={(e) => {
            const files = fromFolderPicker(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length > 0) onAdd(files);
          }}
        />
      </label>
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </section>
  );
}
