import { parseIp } from '@benchside/dns';
import { describe, expect, it } from 'vitest';
import { inCidr, isPublic } from './ip.ts';

describe('public addresses', () => {
  it('ENV-8: given unspecified, multicast, broadcast, and site-local addresses, when checked, then none is public', () => {
    for (const text of [
      '0.0.0.0',
      '0.1.2.3',
      '224.0.0.1',
      '239.255.255.250',
      '255.255.255.255',
      '::',
      'ff02::1',
      'fec0::1',
    ]) {
      const ip = parseIp(text);
      expect(ip && isPublic(ip), text).toBe(false);
    }
  });

  it('ENV-8: given private, carrier-grade NAT, loopback, link-local, and ULA addresses, when checked, then none is public', () => {
    for (const text of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '::1',
      'fe80::1',
      'fd00::1',
    ]) {
      const ip = parseIp(text);
      expect(ip && isPublic(ip), text).toBe(false);
    }
  });

  it('ENV-8: given documentation-range and other public addresses, when checked, then they are public', () => {
    for (const text of ['192.0.2.1', '172.32.0.1', '100.128.0.1', '2001:db8::1', '203.0.113.9']) {
      const ip = parseIp(text);
      expect(ip && isPublic(ip), text).toBe(true);
    }
  });
});

describe('CIDR', () => {
  const ip = (t: string) => parseIp(t) as NonNullable<ReturnType<typeof parseIp>>;

  it('SPF-22: given addresses inside and outside a prefix, when matched, then only those inside match', () => {
    expect(inCidr(ip('192.0.2.77'), ip('192.0.2.0'), 24)).toBe(true);
    expect(inCidr(ip('192.0.3.1'), ip('192.0.2.0'), 24)).toBe(false);
    expect(inCidr(ip('192.0.2.1'), ip('192.0.2.1'), 32)).toBe(true);
    expect(inCidr(ip('203.0.113.9'), ip('192.0.2.1'), 0)).toBe(true);
    expect(inCidr(ip('2001:db8::1'), ip('2001:db8::'), 32)).toBe(true);
    expect(inCidr(ip('2001:db9::1'), ip('2001:db8::'), 32)).toBe(false);
    expect(inCidr(ip('192.0.2.1'), ip('2001:db8::'), 0)).toBe(false);
  });

  it('SPF-22: given a prefix that is not a byte boundary, when matched, then the partial byte is compared', () => {
    expect(inCidr(ip('192.0.2.127'), ip('192.0.2.0'), 25)).toBe(true);
    expect(inCidr(ip('192.0.2.128'), ip('192.0.2.0'), 25)).toBe(false);
  });
});
