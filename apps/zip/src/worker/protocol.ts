/** Messages between the UI and the analysis worker (zip-architecture.md). */

import type { NestedResult, RefusalReason, ZipReport } from '@benchside/zip';

export type ToWorker =
  | { readonly type: 'analyze'; readonly id: number; readonly file: Blob }
  | { readonly type: 'open'; readonly id: number; readonly path: readonly number[] };

export type FromWorker =
  | { readonly type: 'report'; readonly id: number; readonly report: ZipReport }
  | { readonly type: 'refused'; readonly id: number; readonly reason: RefusalReason }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };

export type { NestedResult };
