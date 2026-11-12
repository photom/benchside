/** Files from a drop or a picker, in the order INP-1 and INP-11 give. */

export interface Picked {
  readonly file: File;
  /** The name, or for a folder file its path starting with the folder's name (INP-11). */
  readonly path: string;
  readonly fromFolder: boolean;
}

/** INP-11: by code point. JavaScript's `<` compares UTF-16 code units, which differs above U+FFFF. */
export function compareCodePoints(a: string, b: string): number {
  const x = a[Symbol.iterator]();
  const y = b[Symbol.iterator]();
  for (;;) {
    const p = x.next();
    const q = y.next();
    if (p.done || q.done) return p.done ? (q.done ? 0 : -1) : 1;
    const d = (p.value.codePointAt(0) as number) - (q.value.codePointAt(0) as number);
    if (d !== 0) return d;
  }
}

const byPath = (a: Picked, b: Picked) => compareCodePoints(a.path, b.path);

/** INP-1: picked files keep the order given. */
export function fromPicker(files: Iterable<File>): Picked[] {
  return [...files].map((file) => ({ file, path: file.name, fromFolder: false }));
}

/** INP-11: a picked folder (`webkitdirectory`), by relative path. */
export function fromFolderPicker(files: Iterable<File>): Picked[] {
  return [...files]
    .map((file) => ({ file, path: file.webkitRelativePath || file.name, fromFolder: true }))
    .sort(byPath);
}

/** INP-1, INP-11: dropped files first, in order, then each dropped folder walked and sorted. */
export async function fromDrop(items: DataTransferItemList): Promise<Picked[]> {
  const loose: Picked[] = [];
  const folders: FileSystemDirectoryEntry[] = [];
  // Entries must be taken before the first await: the list empties once the drop event ends.
  const entries = [...items].map((item) => item.webkitGetAsEntry());
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) folders.push(entry as FileSystemDirectoryEntry);
    else if (entry.isFile) {
      loose.push({
        file: await fileOf(entry as FileSystemFileEntry),
        path: entry.name,
        fromFolder: false,
      });
    }
  }
  const out = loose;
  for (const folder of folders) {
    const files: Picked[] = [];
    await walk(folder, folder.name, files);
    out.push(...files.sort(byPath));
  }
  return out;
}

async function walk(dir: FileSystemDirectoryEntry, path: string, out: Picked[]): Promise<void> {
  for (const entry of await readAll(dir)) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory) await walk(entry as FileSystemDirectoryEntry, child, out);
    else if (entry.isFile) {
      out.push({ file: await fileOf(entry as FileSystemFileEntry), path: child, fromFolder: true });
    }
  }
}

/** `readEntries` returns entries in batches; an empty batch ends the folder. */
async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

const fileOf = (entry: FileSystemFileEntry) =>
  new Promise<File>((ok, fail) => entry.file(ok, fail));
