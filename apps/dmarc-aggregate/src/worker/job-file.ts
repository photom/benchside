import type { JobFile } from '@benchside/dmarc-aggregate';
import type { AddedFile } from './protocol.ts';

/** The job reads a `File` only when its turn comes (PRG-1). */
export const toJobFile = ({ file, path, fromFolder }: AddedFile): JobFile => ({
  name: path,
  size: file.size,
  fromFolder,
  read: async () => new Uint8Array(await file.arrayBuffer()),
});
