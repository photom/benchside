import { useState } from 'preact/hooks';
import './drop-zone.css';

/** Accepts one file by drag and drop or the file picker. */
export function DropZone({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <label
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
        const file = e.dataTransfer?.files[0];
        if (file) onFile(file);
      }}
    >
      {label}{' '}
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) onFile(file);
        }}
      />
    </label>
  );
}
