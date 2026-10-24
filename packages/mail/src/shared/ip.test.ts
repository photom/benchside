import { describe, expect, it } from 'vitest';
import { isPublic, parseIp } from './ip.ts';

describe('IP addresses', () => {
  it('given a dotted quad, when parsed, then it is an IPv4 address', () => {
    expect(parseIp('192.0.2.1')).toMatchObject({ version: 4, text: '192.0.2.1' });
  });

  it('given a dotted quad with an octet over 255 or a missing octet, when parsed, then it is not an IP', () => {
    expect(parseIp('192.0.2.256')).toBeNull();
    expect(parseIp('192.0.2')).toBeNull();
  });

  it('ENV-17: given octets with leading zeros, when parsed, then they are decimal', () => {
    expect(parseIp('[192.168.001.010]')?.text).toBe('192.168.1.10');
    expect(parseIp('010.0.0.1')?.text).toBe('10.0.0.1');
    expect(parseIp('1.2.3.0001')).toBeNull();
  });

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

  it('ENV-6: given [IPv6:addr], [addr], and bare addr, when parsed, then all give the same address', () => {
    const expected = { version: 6, text: '2001:db8::1' };
    expect(parseIp('[IPv6:2001:db8::1]')).toMatchObject(expected);
    expect(parseIp('[2001:db8::1]')).toMatchObject(expected);
    expect(parseIp('2001:db8::1')).toMatchObject(expected);
  });

  it('given [IPv4] with brackets, when parsed, then it is an IPv4 address', () => {
    expect(parseIp('[192.0.2.1]')).toMatchObject({ version: 4, text: '192.0.2.1' });
  });

  it('ENV-6: given an IPv6 address with leading zeros and upper case, when parsed, then it is in RFC 5952 form', () => {
    expect(parseIp('2001:0DB8:0000:0000:0000:0000:0000:00AB')?.text).toBe('2001:db8::ab');
  });

  it('ENV-6: given two runs of zero groups, when parsed, then only the longest (first on a tie) becomes ::', () => {
    expect(parseIp('2001:db8:0:0:1:0:0:0')?.text).toBe('2001:db8:0:0:1::');
    expect(parseIp('2001:0:0:1:0:0:1:1')?.text).toBe('2001::1:0:0:1:1');
  });

  it('ENV-6: given a single zero group, when parsed, then it is not shortened to ::', () => {
    expect(parseIp('2001:db8:0:1:1:1:1:1')?.text).toBe('2001:db8:0:1:1:1:1:1');
  });

  it('ENV-7: given ::ffff:a.b.c.d, when parsed, then it is converted to IPv4', () => {
    expect(parseIp('::ffff:192.0.2.1')).toMatchObject({ version: 4, text: '192.0.2.1' });
    expect(parseIp('[IPv6:::FFFF:192.0.2.1]')).toMatchObject({ version: 4, text: '192.0.2.1' });
  });

  it('ENV-6: given edge forms (all zeros, loopback, full mapped form, IPv4 tail without ::), when parsed, then each is normalized', () => {
    expect(parseIp('::')?.text).toBe('::');
    expect(parseIp('0:0:0:0:0:0:0:1')?.text).toBe('::1');
    expect(parseIp('0:0:0:0:0:ffff:192.0.2.1')).toMatchObject({ version: 4, text: '192.0.2.1' });
    expect(parseIp('64:ff9b::192.0.2.1')?.text).toBe('64:ff9b::c000:201');
    expect(parseIp('192.0.2.1::')).toBeNull();
  });

  it('given an IPv6 address with too many groups or two ::, when parsed, then it is not an IP', () => {
    expect(parseIp('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIp('1::2::3')).toBeNull();
    expect(parseIp('1:2:3:4:5:6:7')).toBeNull();
    expect(parseIp('12345::1')).toBeNull();
  });

  it('given a host name or empty text, when parsed, then it is not an IP', () => {
    expect(parseIp('mx.example.net')).toBeNull();
    expect(parseIp('')).toBeNull();
    expect(parseIp('[]')).toBeNull();
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
