/** Messages between the UI and the reading worker (dmarc-aggregate-architecture.md, Worker protocol). */
import type { Filters, Focus, LookupProvider, Names, Snapshot } from '@benchside/dmarc-aggregate';

export interface AddedFile {
  readonly file: File;
  readonly path: string;
  readonly fromFolder: boolean;
}

export type ToWorker =
  | { readonly type: 'add'; readonly id: number; readonly files: readonly AddedFile[] }
  | {
      readonly type: 'view';
      readonly id: number;
      readonly filters: Filters;
      readonly focus: Focus | null;
    }
  | { readonly type: 'stop'; readonly id: number }
  /** RDNS-1, RDNS-9: on starts a session, off ends it. */
  | {
      readonly type: 'lookup';
      readonly id: number;
      readonly on: boolean;
      readonly provider: LookupProvider;
    }
  | { readonly type: 'clear'; readonly id: number };

export type FromWorker =
  | ({ readonly type: 'snapshot' } & Snapshot)
  | Names
  | { readonly type: 'failed'; readonly id: number | null; readonly message: string };
