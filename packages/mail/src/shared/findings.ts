import type { ByteRange } from './bytes.ts';

export type Severity = 'error' | 'warning' | 'info';

export type Evidence =
  | { readonly kind: 'header'; readonly index: number }
  | { readonly kind: 'bytes'; readonly range: ByteRange }
  | { readonly kind: 'dns'; readonly queryId: string };

export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly message: string;
  readonly evidence: readonly Evidence[];
}
