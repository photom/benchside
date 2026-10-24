import { describe, expect, it } from 'vitest';
import { cspPolicy, DOH_ORIGINS, defineApp } from './vite.shared.ts';

describe('cspPolicy', () => {
  it('REQ-MAIL-001: given no allowed origins, when built, then connect-src is none', () => {
    expect(cspPolicy([])).toContain("connect-src 'none'");
  });

  it('DNS-9: given the DoH origins, when built, then connect-src lists exactly those', () => {
    expect(cspPolicy(DOH_ORIGINS)).toContain(
      'connect-src https://cloudflare-dns.com https://dns.google;',
    );
  });

  it('0004: given any app, when built, then workers may start only from blob: URLs', () => {
    expect(cspPolicy([])).toContain('worker-src blob:');
  });

  it('given any app, when built, then base-uri and form-action are none', () => {
    const policy = cspPolicy([]);
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy.startsWith("default-src 'self'")).toBe(true);
  });
});

describe('defineApp', () => {
  it('0002: given home, when configured, then it is served at /benchside/', () => {
    expect(defineApp('home', { connect: [] }).base).toBe('/benchside/');
  });

  it('0002: given a tool, when configured, then it is served at /benchside/<tool>/', () => {
    expect(defineApp('mail', { connect: DOH_ORIGINS }).base).toBe('/benchside/mail/');
  });
});
