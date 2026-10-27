/** PNG predictors for FlateDecode (7.4.4.4, Tables 8 and 10; RFC 2083 section 6). */

export interface PredictorParams {
  readonly columns: number;
  readonly colors: number;
  readonly bitsPerComponent: number;
}

export type PredictorResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'error'; readonly message: string };

/** XST-3: undoes PNG filtering; each row starts with its tag byte (0 None .. 4 Paeth). */
export function pngDecode(data: Uint8Array, p: PredictorParams): PredictorResult {
  const rowLength = Math.ceil((p.columns * p.colors * p.bitsPerComponent) / 8);
  const bpp = Math.max(1, Math.ceil((p.colors * p.bitsPerComponent) / 8));
  if (rowLength < 1) return { kind: 'error', message: 'The predictor row length is 0.' };
  // REQ-PDF-003: a row longer than the data is never allocated.
  if (rowLength + 1 > data.length) {
    return { kind: 'error', message: `A row of ${rowLength} bytes is longer than the data.` };
  }
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let prior = new Uint8Array(rowLength);
  for (let r = 0; r < rows; r++) {
    const tag = data[r * (rowLength + 1)] as number;
    const input = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
    const row = out.subarray(r * rowLength, (r + 1) * rowLength);
    for (let x = 0; x < rowLength; x++) {
      const left = x >= bpp ? (row[x - bpp] as number) : 0;
      const above = prior[x] as number;
      const upperLeft = x >= bpp ? (prior[x - bpp] as number) : 0;
      let predicted: number;
      switch (tag) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = above;
          break;
        case 3:
          predicted = Math.floor((left + above) / 2);
          break;
        case 4:
          predicted = paeth(left, above, upperLeft);
          break;
        default:
          return { kind: 'error', message: `Row ${r} has predictor tag ${tag}.` };
      }
      row[x] = ((input[x] as number) + predicted) & 0xff;
    }
    prior = row;
  }
  return { kind: 'ok', bytes: out };
}

/** RFC 2083 section 6.6: ties go to left, then above, then upper left. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
