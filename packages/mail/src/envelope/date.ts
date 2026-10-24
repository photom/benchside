/**
 * RFC 5322 date-time (§3.3) including the obsolete forms of §4.3: two-digit
 * years, alphabetic zones, comments. Returns null when the text is not a valid date.
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** §4.3 obs-zone offsets in minutes. Other alphabetic zones (military letters, UTC, CEST, …) count as -0000, as §4.3 advises. */
const ZONES: Record<string, number> = {
  ut: 0,
  gmt: 0,
  est: -300,
  edt: -240,
  cst: -360,
  cdt: -300,
  mst: -420,
  mdt: -360,
  pst: -480,
  pdt: -420,
};

const DATE_TIME =
  /^(?:[a-z]{3}\s*,\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[a-z]{1,5})$/i;

export function parseDateTime(text: string): Date | null {
  const m = DATE_TIME.exec(withoutComments(text).replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const [, dayText, monthText, yearText, hourText, minuteText, secondText, zoneText] = m;
  const month = MONTHS.indexOf((monthText ?? '').toLowerCase());
  if (month < 0) return null;
  let year = Number(yearText);
  if ((yearText ?? '').length === 2) year += year < 50 ? 2000 : 1900;
  else if ((yearText ?? '').length === 3) year += 1900;
  else if (year < 1900) return null; // §3.3: "any numeric year 1900 or later"
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? '0');
  if (hour > 23 || minute > 59 || second > 60) return null;
  const offset = zoneOffset(zoneText);
  if (offset === null) return null;
  const utc = Date.UTC(year, month, day, hour, minute, Math.min(second, 59)) - offset * 60_000;
  // "MUST be semantically valid" (§3.3): 31 Feb would roll over into March.
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return new Date(utc);
}

function zoneOffset(zone: string | undefined): number | null {
  if (zone === undefined) return null; // §3.3: the zone is required
  if (/^[+-]\d{4}$/.test(zone)) {
    const sign = zone.startsWith('-') ? -1 : 1;
    return sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  }
  return ZONES[zone.toLowerCase()] ?? 0;
}

/** Removes (possibly nested) comments, as CFWS allows them almost anywhere (§4.3). */
function withoutComments(text: string): string {
  let out = '';
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out;
}
