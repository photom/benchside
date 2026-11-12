/**
 * The element table of Format (docs/reference/dmarc-aggregate/format.md#elements) as data.
 * The reader and the tests both use it, so the two schemas are written down once (FMT-4..9).
 */

/** `R` exactly one, `O` zero or one, `*` zero or more, `+` one or more, `no` not in that schema. */
export type Multiplicity = 'R' | 'O' | '*' | '+' | 'no';

export interface ElementRule {
  /** Path from the root, `/`-separated local names. */
  readonly path: string;
  readonly rfc7489: Multiplicity;
  readonly rfc9990: Multiplicity;
  /**
   * A container the spec table does not list (FMT-6 still knows its name). FMT-8 does not report
   * it missing; its required children are reported instead, as the table says.
   */
  readonly container?: true;
}

export const ELEMENTS: readonly ElementRule[] = [
  { path: 'version', rfc7489: 'R', rfc9990: 'O' },
  { path: 'report_metadata', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'report_metadata/org_name', rfc7489: 'R', rfc9990: 'R' },
  { path: 'report_metadata/email', rfc7489: 'R', rfc9990: 'R' },
  { path: 'report_metadata/extra_contact_info', rfc7489: 'O', rfc9990: 'O' },
  { path: 'report_metadata/report_id', rfc7489: 'R', rfc9990: 'R' },
  { path: 'report_metadata/date_range', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'report_metadata/date_range/begin', rfc7489: 'R', rfc9990: 'R' },
  { path: 'report_metadata/date_range/end', rfc7489: 'R', rfc9990: 'R' },
  { path: 'report_metadata/error', rfc7489: '*', rfc9990: 'O' },
  { path: 'report_metadata/generator', rfc7489: 'no', rfc9990: 'O' },
  { path: 'policy_published', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'policy_published/domain', rfc7489: 'R', rfc9990: 'R' },
  { path: 'policy_published/adkim', rfc7489: 'O', rfc9990: 'O' },
  { path: 'policy_published/aspf', rfc7489: 'O', rfc9990: 'O' },
  { path: 'policy_published/p', rfc7489: 'R', rfc9990: 'R' },
  { path: 'policy_published/sp', rfc7489: 'R', rfc9990: 'O' },
  { path: 'policy_published/np', rfc7489: 'no', rfc9990: 'O' },
  { path: 'policy_published/pct', rfc7489: 'R', rfc9990: 'no' },
  { path: 'policy_published/fo', rfc7489: 'R', rfc9990: 'O' },
  { path: 'policy_published/discovery_method', rfc7489: 'no', rfc9990: 'O' },
  { path: 'policy_published/testing', rfc7489: 'no', rfc9990: 'O' },
  { path: 'extension', rfc7489: 'no', rfc9990: 'O' },
  { path: 'record', rfc7489: '+', rfc9990: '+' },
  { path: 'record/row', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'record/row/source_ip', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/row/count', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/row/policy_evaluated', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'record/row/policy_evaluated/disposition', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/row/policy_evaluated/dkim', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/row/policy_evaluated/spf', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/row/policy_evaluated/reason', rfc7489: '*', rfc9990: '*' },
  { path: 'record/row/policy_evaluated/reason/type', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/row/policy_evaluated/reason/comment', rfc7489: 'O', rfc9990: 'O' },
  { path: 'record/identifiers', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'record/identifiers/header_from', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/identifiers/envelope_from', rfc7489: 'R', rfc9990: 'O' },
  { path: 'record/identifiers/envelope_to', rfc7489: 'O', rfc9990: 'O' },
  { path: 'record/auth_results', rfc7489: 'R', rfc9990: 'R', container: true },
  { path: 'record/auth_results/dkim', rfc7489: '*', rfc9990: '*' },
  { path: 'record/auth_results/dkim/domain', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/auth_results/dkim/selector', rfc7489: 'O', rfc9990: 'R' },
  { path: 'record/auth_results/dkim/result', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/auth_results/dkim/human_result', rfc7489: 'O', rfc9990: 'O' },
  { path: 'record/auth_results/spf', rfc7489: '+', rfc9990: 'O' },
  { path: 'record/auth_results/spf/domain', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/auth_results/spf/scope', rfc7489: 'R', rfc9990: 'O' },
  { path: 'record/auth_results/spf/result', rfc7489: 'R', rfc9990: 'R' },
  { path: 'record/auth_results/spf/human_result', rfc7489: 'no', rfc9990: 'O' },
];

export const BY_PATH: ReadonlyMap<string, ElementRule> = new Map(ELEMENTS.map((e) => [e.path, e]));

/** Enumerations per path: values of each schema (FMT-10, FMT-16). */
export const ENUMS: Readonly<
  Record<string, { rfc7489: readonly string[]; rfc9990: readonly string[] }>
> = {
  'policy_published/adkim': { rfc7489: ['r', 's'], rfc9990: ['r', 's'] },
  'policy_published/aspf': { rfc7489: ['r', 's'], rfc9990: ['r', 's'] },
  'policy_published/p': {
    rfc7489: ['none', 'quarantine', 'reject'],
    rfc9990: ['none', 'quarantine', 'reject'],
  },
  'policy_published/sp': {
    rfc7489: ['none', 'quarantine', 'reject'],
    rfc9990: ['none', 'quarantine', 'reject'],
  },
  'policy_published/np': { rfc7489: [], rfc9990: ['none', 'quarantine', 'reject'] },
  'policy_published/discovery_method': { rfc7489: [], rfc9990: ['psl', 'treewalk'] },
  'policy_published/testing': { rfc7489: [], rfc9990: ['n', 'y'] },
  'record/row/policy_evaluated/disposition': {
    rfc7489: ['none', 'quarantine', 'reject'],
    rfc9990: ['none', 'pass', 'quarantine', 'reject'],
  },
  'record/row/policy_evaluated/dkim': { rfc7489: ['pass', 'fail'], rfc9990: ['pass', 'fail'] },
  'record/row/policy_evaluated/spf': { rfc7489: ['pass', 'fail'], rfc9990: ['pass', 'fail'] },
  'record/row/policy_evaluated/reason/type': {
    rfc7489: [
      'forwarded',
      'sampled_out',
      'trusted_forwarder',
      'mailing_list',
      'local_policy',
      'other',
    ],
    rfc9990: ['trusted_forwarder', 'mailing_list', 'local_policy', 'other', 'policy_test_mode'],
  },
  'record/auth_results/dkim/result': {
    rfc7489: ['none', 'pass', 'fail', 'policy', 'neutral', 'temperror', 'permerror'],
    rfc9990: ['none', 'pass', 'fail', 'policy', 'neutral', 'temperror', 'permerror'],
  },
  'record/auth_results/spf/scope': { rfc7489: ['helo', 'mfrom'], rfc9990: ['mfrom'] },
  'record/auth_results/spf/result': {
    rfc7489: ['none', 'neutral', 'pass', 'fail', 'softfail', 'temperror', 'permerror'],
    rfc9990: ['none', 'neutral', 'pass', 'fail', 'softfail', 'temperror', 'permerror', 'policy'],
  },
};

export const NAMESPACES = {
  rfc9990: 'urn:ietf:params:xml:ns:dmarc-2.0',
  rfc7489: 'http://dmarc.org/dmarc-xml/0.1',
} as const;
