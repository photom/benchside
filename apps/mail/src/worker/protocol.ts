/** Messages between the UI and the analysis worker (detailed design §8). */

import type { AnalyzeOptions, PartialReport } from '@benchside/mail';

export type ToWorker =
  | {
      readonly type: 'analyze';
      readonly id: number;
      readonly bytes: Uint8Array;
      readonly options: AnalyzeOptions;
    }
  | { readonly type: 'cancel'; readonly id: number };

export type FromWorker =
  | { readonly type: 'report'; readonly id: number; readonly report: PartialReport }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };
