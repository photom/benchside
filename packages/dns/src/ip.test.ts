import { describe, expect, it } from 'vitest';
import { nibbles, parseIp, reverseName } from './ip.ts';

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

  it('ENV-6: given [IPv6:addr], [addr], and bare addr, when parsed, then all give the same address', () => {
    const expected = { version: 6, text: '2001:db8::1' };
    expect(parseIp('[IPv6:2001:db8::1]')).toMatchObject(expected);
    expect(parseIp('[2001:db8::1]')).toMatchObject(expected);
    expect(parseIp('2001:db8::1')).toMatchObject(expected);
  });

  it('ENV-6: given the IPv6: tag outside brackets or before an IPv4 address, when parsed, then it is not an IP', () => {
    expect(parseIp('[IPv6:192.0.2.1]')).toBeNull();
    expect(parseIp('IPv6:192.0.2.1')).toBeNull();
    expect(parseIp('IPv6:2001:db8::1')).toBeNull();
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
});

describe('reverse names', () => {
  const ip = (t: string) => parseIp(t) as NonNullable<ReturnType<typeof parseIp>>;

  it('RDNS-3: given an IPv4 address, when its reverse name is built, then the four octets are reversed under in-addr.arpa', () => {
    expect(reverseName(ip('192.0.2.10'))).toBe('10.2.0.192.in-addr.arpa');
  });

  it('RDNS-3: given an IPv6 address, when its reverse name is built, then the 32 nibbles are reversed under ip6.arpa', () => {
    expect(reverseName(ip('2001:db8::1'))).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
  });

  it('RDNS-3: given an IPv4-mapped IPv6 address, when its reverse name is built, then it is the IPv4 reverse name', () => {
    expect(reverseName(ip('::ffff:198.51.100.7'))).toBe('7.100.51.198.in-addr.arpa');
  });
});

describe('nibbles', () => {
  it('RFC 3596 §2.5: given IPv6 bytes, when expanded, then they are 32 hex nibbles in address order', () => {
    const ip = parseIp('2001:db8::1');
    expect(ip && nibbles(ip.bytes)).toBe(
      '2.0.0.1.0.d.b.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.1',
    );
  });
});
