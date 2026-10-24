import { describe, expect, it } from 'vitest';
import { chooseBoundary } from './boundary.ts';
import type { ParsedReceived } from './received.ts';

const hop = (field: number, clientIp?: string): ParsedReceived =>
  clientIp
    ? { field, confidence: 'grammar', rule: 'ENV-1', helo: 'h.example', clientIp }
    : { field, confidence: 'none' };

describe('trust boundary', () => {
  it('ENV-8: given an internal hop above a public hop, when chosen, then the boundary is the public hop', () => {
    const { boundary, findings } = chooseBoundary([hop(0), hop(4, '192.0.2.1')]);
    expect(boundary?.field).toBe(4);
    expect(findings).toEqual([]);
  });

  it('ENV-8: given a private hop above a public hop, when chosen, then the private hop is skipped', () => {
    const { boundary } = chooseBoundary([
      hop(0, '10.0.0.5'),
      hop(1, 'fd00::5'),
      hop(2, '198.51.100.7'),
      hop(3, '203.0.113.1'),
    ]);
    expect(boundary?.field).toBe(2);
  });

  it('ENV-9: given only private hops, when chosen, then the boundary is the topmost Received with envelope.no-public-hop', () => {
    const { boundary, findings } = chooseBoundary([hop(1, '192.168.0.2'), hop(5, '127.0.0.1')]);
    expect(boundary?.field).toBe(1);
    expect(findings).toEqual([
      expect.objectContaining({
        id: 'envelope.no-public-hop',
        severity: 'warning',
        evidence: [{ kind: 'header', index: 1 }],
      }),
    ]);
  });

  it('ENV-9: given no Received fields, when chosen, then there is no boundary and no finding', () => {
    expect(chooseBoundary([])).toEqual({ boundary: null, findings: [] });
  });

  it('ENV-10: given a user choice, when chosen, then that field is the boundary', () => {
    const { boundary, findings } = chooseBoundary([hop(0, '192.0.2.1'), hop(3, '10.0.0.1')], 3);
    expect(boundary?.field).toBe(3);
    expect(findings).toEqual([]);
  });

  it('ENV-10: given a user choice that is not a Received field, when chosen, then the default applies', () => {
    expect(chooseBoundary([hop(0, '192.0.2.1')], 7).boundary?.field).toBe(0);
  });
});
