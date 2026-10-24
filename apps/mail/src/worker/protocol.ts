/** Messages between the UI and the analysis worker (detailed design §8). */

/** Walking-skeleton result. Replaced by the full Report later. */
export interface SkeletonReport {
  readonly headers: readonly { readonly index: number; readonly name: string }[];
  readonly hasBody: boolean;
}

export type ToWorker =
  | { readonly type: 'analyze'; readonly id: number; readonly bytes: Uint8Array }
  | { readonly type: 'cancel'; readonly id: number };

export type FromWorker =
  | { readonly type: 'report'; readonly id: number; readonly report: SkeletonReport }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };
