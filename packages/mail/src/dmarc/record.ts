/** DMARC record syntax (DMARC-9, DMARC-23). */
import { parseTagList } from '../shared/tag-list.ts';

/** The tags of a valid DMARC record: `v=DMARC1` first and a tag list that parses; else null. */
export function parseDmarcRecord(text: string): Map<string, string> | null {
  const list = parseTagList(text);
  if (list.errors.length > 0 || list.duplicates.length > 0) return null;
  const [first] = list.tags;
  return first?.[0] === 'v' && first[1] === 'DMARC1' ? list.tags : null;
}

/** DMARC-9: keep TXT records that start with `v=DMARC1`. */
export const looksLikeDmarc = (text: string) => /^v[ \t]*=[ \t]*DMARC1[ \t]*(;|$)/.test(text);
