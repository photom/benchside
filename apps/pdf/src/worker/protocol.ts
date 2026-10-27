/** Messages between the UI and the analysis worker (pdf-architecture.md). */
import type { PdfReport } from '@benchside/pdf';

export type ToWorker = { readonly type: 'analyze'; readonly id: number; readonly file: Blob };

export type FromWorker =
  | { readonly type: 'report'; readonly id: number; readonly report: PdfReport }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };
