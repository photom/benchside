const utf8 = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

/**
 * Joins the character-strings of one TXT record (DNS-7; RFC 7208 §3.3, RFC 6376 §3.6.2.2).
 * Quoted presentation form (Cloudflare) is unquoted and unescaped; `\DDD` is one
 * decimal byte, and the bytes are decoded as UTF-8. Unquoted data (Google) is used as is.
 */
export function joinTxtData(data: string): string {
  if (!data.trimStart().startsWith('"')) return data;
  const bytes: number[] = [];
  const text = (t: string) => bytes.push(...encoder.encode(t));
  let i = 0;
  while (i < data.length) {
    if (data[i] !== '"') {
      i++;
      continue;
    }
    i++;
    while (i < data.length && data[i] !== '"') {
      const c = data[i] as string;
      if (c !== '\\' || i + 1 >= data.length) {
        text(c);
        i++;
        continue;
      }
      const ddd = /^\d{3}/.exec(data.slice(i + 1, i + 4))?.[0];
      if (ddd !== undefined && Number(ddd) <= 255) {
        bytes.push(Number(ddd));
        i += 4;
      } else if (ddd !== undefined) {
        text(`\\${ddd}`); // not a byte value: keep as written
        i += 4;
      } else {
        text(data[i + 1] as string);
        i += 2;
      }
    }
    i++; // closing quote
  }
  return utf8.decode(new Uint8Array(bytes));
}
