/** Builds DMARC aggregate report XML for tests (RFC 9990 namespace, no findings by default). */
import { type XmlDocument, XmlReader } from '../xml/reader.ts';

export interface ReportOpts {
  org?: string;
  id?: string | null;
  domain?: string;
  begin?: number | null;
  end?: number | null;
  count?: number;
  /** Changes the bytes without changing the identity. */
  note?: string;
  /** Record elements; one passing record when omitted. */
  records?: string;
  /** `report_metadata/error` texts. */
  errors?: string[];
  /** Elements of `policy_published` after `domain`. */
  policy?: string;
  /** The root namespace; null for none. */
  namespace?: string | null;
}

/** One record: policy_evaluated results and raw results. */
export const rec = (o: {
  ip?: string;
  dkim?: string;
  spf?: string;
  rawDkim?: string;
  dkimDomain?: string;
  rawSpf?: string;
  count?: number;
  disposition?: string;
  headerFrom?: string;
}) =>
  `<record><row><source_ip>${o.ip ?? '192.0.2.10'}</source_ip><count>${o.count ?? 1}</count><policy_evaluated><disposition>${o.disposition ?? 'none'}</disposition><dkim>${o.dkim ?? 'fail'}</dkim><spf>${o.spf ?? 'fail'}</spf></policy_evaluated></row><identifiers><header_from>${o.headerFrom ?? 'example.com'}</header_from></identifiers><auth_results>${o.rawDkim ? `<dkim><domain>${o.dkimDomain ?? 'example.com'}</domain><selector>s</selector><result>${o.rawDkim}</result></dkim>` : ''}<spf><domain>example.com</domain><result>${o.rawSpf ?? 'fail'}</result></spf></auth_results></record>`;
/** DMARC pass by DKIM with raw SPF fail: PATH-3, which makes the IP a forwarder. */
export const forwarded = (ip: string, count = 1) =>
  rec({ ip, dkim: 'pass', rawDkim: 'pass', count });
/** DMARC fail with nothing else: CAUSE-9, or CAUSE-3 at a forwarder IP. */
export const failing = (ip: string, count = 1, disposition = 'none') =>
  rec({ ip, rawDkim: 'fail', dkimDomain: 'x.example.net', count, disposition });
/** DMARC pass by SPF: PATH-1. */
export const direct = (ip: string, count = 1) => rec({ ip, spf: 'pass', rawSpf: 'pass', count });

export const reportXml = (o: ReportOpts = {}) => {
  const domain = o.domain ?? 'example.com';
  const id = o.id === undefined ? 'r-1' : o.id;
  const begin = o.begin === undefined ? 1_700_000_000 : o.begin;
  const end = o.end === undefined ? 1_700_086_399 : o.end;
  const range =
    begin === null || end === null
      ? ''
      : `<date_range><begin>${begin}</begin><end>${end}</end></date_range>`;
  const records =
    o.records ??
    `<record><row><source_ip>192.0.2.10</source_ip><count>${o.count ?? 3}</count><policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>${domain}</header_from></identifiers><auth_results><spf><domain>${domain}</domain><result>pass</result></spf></auth_results></record>`;
  const ns = o.namespace === undefined ? 'urn:ietf:params:xml:ns:dmarc-2.0' : o.namespace;
  return `<feedback${ns === null ? '' : ` xmlns="${ns}"`}>${o.note ? `<!-- ${o.note} -->` : ''}<version>1.0</version><report_metadata><org_name>${o.org ?? 'Example Receiver'}</org_name><email>d@example.org</email>${id === null ? '' : `<report_id>${id}</report_id>`}${range}${(o.errors ?? []).map((e) => `<error>${e}</error>`).join('')}</report_metadata><policy_published><domain>${domain}</domain>${o.policy ?? '<p>none</p>'}</policy_published>${records}</feedback>`;
};

export const parse = (text: string | Uint8Array): XmlDocument => {
  const r = new XmlReader();
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const doc = [...r.push(bytes).documents, ...r.end().documents][0];
  if (!doc) throw new Error('no document');
  return doc;
};

/** 2023-11-16T00:00:00Z: the time of reading in tests. */
export const NOW = 1_700_092_800;
export const DAY = 86_400;
/** 2023-11-14T00:00:00Z */
export const D14 = 1_699_920_000;
