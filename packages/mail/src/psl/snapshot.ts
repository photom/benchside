/** The bundled Public Suffix List snapshot (decision 0003), parsed on first use (DMARC-7). */
import text from '../../data/public_suffix_list.dat?raw';
import { type PublicSuffixList, parsePsl } from './lookup.ts';

let parsed: PublicSuffixList | undefined;

export function bundledPsl(): PublicSuffixList {
  parsed ??= parsePsl(text);
  return parsed;
}
