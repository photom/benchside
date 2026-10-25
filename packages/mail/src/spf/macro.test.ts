import { describe, expect, it } from 'vitest';
import { type Ip, parseIp } from '../shared/ip.ts';
import { expandMacro, type MacroEnv, parseMacroString } from './macro.ts';

const env = (ip = '192.0.2.3', o: Partial<MacroEnv> = {}): MacroEnv => ({
  sender: 'strong-bad@email.example.com',
  local: 'strong-bad',
  senderDomain: 'email.example.com',
  domain: 'email.example.com',
  ip: parseIp(ip) as Ip,
  helo: 'mx.example.org',
  receiver: 'mx.example.net',
  time: 1790000000,
  validatedName: async () => 'mx.example.com',
  ...o,
});

async function expand(text: string, e = env(), exp = false) {
  const m = parseMacroString(text, { exp });
  if (!m) throw new Error(`syntax: ${text}`);
  return expandMacro(m, e);
}

describe('SPF macros', () => {
  // RFC 7208 §7.4
  const examples: [string, string][] = [
    ['%{s}', 'strong-bad@email.example.com'],
    ['%{o}', 'email.example.com'],
    ['%{d}', 'email.example.com'],
    ['%{d4}', 'email.example.com'],
    ['%{d3}', 'email.example.com'],
    ['%{d2}', 'example.com'],
    ['%{d1}', 'com'],
    ['%{dr}', 'com.example.email'],
    ['%{d2r}', 'example.email'],
    ['%{l}', 'strong-bad'],
    ['%{l-}', 'strong.bad'],
    ['%{lr}', 'strong-bad'],
    ['%{lr-}', 'bad.strong'],
    ['%{l1r-}', 'strong'],
    ['%{ir}.%{v}._spf.%{d2}', '3.2.0.192.in-addr._spf.example.com'],
    ['%{lr-}.lp._spf.%{d2}', 'bad.strong.lp._spf.example.com'],
    ['%{lr-}.lp.%{ir}.%{v}._spf.%{d2}', 'bad.strong.lp.3.2.0.192.in-addr._spf.example.com'],
    ['%{ir}.%{v}.%{l1r-}.lp._spf.%{d2}', '3.2.0.192.in-addr.strong.lp._spf.example.com'],
    ['%{d2}.trusted-domains.example.net', 'example.com.trusted-domains.example.net'],
  ];
  for (const [macro, expected] of examples) {
    it(`SPF-12: given ${macro} (RFC 7208 §7.4), when expanded, then it is ${expected}`, async () => {
      expect((await expand(macro)).text).toBe(expected);
    });
  }

  it('SPF-12: given %{ir} for an IPv6 client (RFC 7208 §7.4), when expanded, then it is reversed nibbles', async () => {
    expect((await expand('%{ir}.%{v}._spf.%{d2}', env('2001:db8::cb01'))).text).toBe(
      '1.0.b.c.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6._spf.example.com',
    );
  });

  it('SPF-12: given %%, %_, %-, and an uppercase letter, when expanded, then they are %, space, %20, and URL-escaped', async () => {
    expect((await expand('a%%b%_c%-d', env(), true)).text).toBe('a%b c%20d');
    expect((await expand('%{S}')).text).toBe('strong-bad%40email.example.com');
  });

  it('SPF-12: given h, p, and o, when expanded, then they are HELO, the validated name, and the sender domain', async () => {
    expect((await expand('%{h}.%{p}.%{o}')).text).toBe(
      'mx.example.org.mx.example.com.email.example.com',
    );
  });

  it('SPF-27: given c, r, and t in an explanation, when expanded, then they are the IP text, receiver, and time', async () => {
    expect((await expand('%{c} %{r} %{t}', env('2001:db8::cb01'), true)).text).toBe(
      '2001:db8::cb01 mx.example.net 1790000000',
    );
  });

  it('SPF-12: given c, r, or t outside an explanation, when parsed, then it is a syntax error', () => {
    for (const t of ['%{c}', '%{r}', '%{t}'])
      expect(parseMacroString(t, { exp: false })).toBeNull();
  });

  it('SPF-12: given a malformed macro, when parsed, then it is a syntax error', () => {
    for (const t of ['%', '%x', '%{', '%{q}', '%{d0}', '%{d2', 'a b']) {
      expect(parseMacroString(t, { exp: false }), t).toBeNull();
    }
  });

  it('SPF-13, DNS-9: given s, l, i, or p, when expanded, then the name is sensitive; given d, o, h, or v, it is not', async () => {
    for (const t of ['%{s}', '%{l}.x.example', '%{i}.x.example', '%{p}.x.example']) {
      expect((await expand(t)).sensitive, t).toBe(true);
    }
    expect((await expand('%{d}.%{o}.%{h}.%{v}')).sensitive).toBe(false);
  });

  it('SPF-26: given %{p}, when expanded, then the validated name is looked up only then', async () => {
    let asked = 0;
    const e = env(undefined, {
      validatedName: async () => {
        asked++;
        return 'unknown';
      },
    });
    await expand('%{d}', e);
    expect(asked).toBe(0);
    expect((await expand('%{p}', e)).text).toBe('unknown');
    expect(asked).toBe(1);
  });
});
