/** Messages between the UI and the analysis worker (zip-architecture.md). */

import type { NestedResult, ParameterInput, RefusalReason, ZipReport } from '@benchside/zip';

export type ToWorker =
  | {
      readonly type: 'analyze';
      readonly id: number;
      readonly file: Blob;
      readonly parameters: ParameterInput;
    }
  | { readonly type: 'open'; readonly id: number; readonly path: readonly number[] }
  | {
      readonly type: 'read';
      readonly id: number;
      readonly path: readonly number[];
      readonly offset: number;
      readonly byteLength: number;
    };

export type FromWorker =
  | { readonly type: 'report'; readonly id: number; readonly report: ZipReport }
  | { readonly type: 'refused'; readonly id: number; readonly reason: RefusalReason }
  | { readonly type: 'bytes'; readonly id: number; readonly bytes: Uint8Array }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };

/** HEX-2, HEX-3: one hex view page, and the most one read returns. */
export const MAX_READ = 512;

export type { NestedResult };
