import { describe, expect, it } from 'vitest';
import {
  dosDateTime,
  externalAttributes,
  flags,
  internalAttributes,
  method,
  versionMadeBy,
  versionNeeded,
} from './fields.ts';

describe('versions', () => {
  it('FLD-1: given 0x031e, when decoded, then the host is UNIX and the version 3.0', () => {
    expect(versionMadeBy(0x031e)).toEqual({ raw: 0x031e, host: 'UNIX', spec: '3.0' });
  });

  it('FLD-1: given host 19 and version 63, when decoded, then OS X (Darwin), 6.3', () => {
    expect(versionMadeBy((19 << 8) | 63)).toMatchObject({ host: 'OS X (Darwin)', spec: '6.3' });
  });

  it('FLD-1: given host 20, when decoded, then the host is unused', () => {
    expect(versionMadeBy(20 << 8).host).toBe('unused');
  });

  it('FLD-2: given 45, when decoded, then 4.5 and no host', () => {
    expect(versionNeeded(45)).toEqual({ raw: 45, spec: '4.5' });
  });
});

describe('general purpose bit flag', () => {
  it('FLD-3: given bits 0, 3, 11, when decoded, then names each', () => {
    expect(flags(0x0809, 0).bits).toEqual([
      { bit: 0, name: 'Encrypted' },
      { bit: 3, name: 'Data descriptor' },
      { bit: 11, name: 'UTF-8 names and comments (EFS)' },
    ]);
  });

  it('FLD-3: given bits 1 and 2 with method 8, when decoded, then names the compression option', () => {
    expect(flags(0x0006, 8).bits).toEqual([
      { bit: 1, name: 'Super Fast compression (bits 2-1 = 11)' },
      { bit: 2, name: 'Super Fast compression (bits 2-1 = 11)' },
    ]);
  });

  it('FLD-3: given bit 1 with method 0, when decoded, then it is undefined for this method', () => {
    expect(flags(0x0002, 0).bits).toEqual([{ bit: 1, name: 'Undefined for this method' }]);
  });

  it('FLD-3: given bits 7 and 15, when decoded, then unused and reserved', () => {
    expect(flags(0x8080, 0).bits).toEqual([
      { bit: 7, name: 'Unused' },
      { bit: 15, name: 'Reserved' },
    ]);
  });
});

describe('compression method', () => {
  it('FLD-4: given 8, when named, then Deflated', () => {
    expect(method(8)).toEqual({ code: 8, name: 'Deflated' });
  });

  it('FLD-4: given 93, when named, then Zstandard', () => {
    expect(method(93).name).toBe('Zstandard (zstd)');
  });

  it('FLD-4: given 50, when named, then unknown', () => {
    expect(method(50).name).toBe('Unknown');
  });
});

describe('date and time', () => {
  it('FLD-5: given 2025-01-01 12:00:00, when decoded, then gives that text', () => {
    // date: (45 << 9) | (1 << 5) | 1 = 0x5a21, time: 12 << 11 = 0x6000
    expect(dosDateTime(0x6000, 0x5a21).text).toBe('2025-01-01 12:00:00');
  });

  it('FLD-5: given odd seconds field 29, when decoded, then 58 seconds', () => {
    expect(dosDateTime(29, 0x0021).text).toBe('1980-01-01 00:00:58');
  });

  it('FLD-5: given month 0, when decoded, then no text', () => {
    expect(dosDateTime(0, 0).text).toBeNull();
  });

  it('FLD-5: given February 30, when decoded, then no text', () => {
    expect(dosDateTime(0, (44 << 9) | (2 << 5) | 30).text).toBeNull();
  });

  it('FLD-5: given February 29 in a leap year, when decoded, then valid', () => {
    expect(dosDateTime(0, (44 << 9) | (2 << 5) | 29).text).toBe('2024-02-29 00:00:00');
  });

  it('FLD-5: given hour 24, when decoded, then no text', () => {
    expect(dosDateTime(24 << 11, 0x5a21).text).toBeNull();
  });
});

describe('attributes', () => {
  it('FLD-6: given internal bit 0, when decoded, then text', () => {
    expect(internalAttributes(1)).toEqual({ raw: 1, text: true });
  });

  it('FLD-7: given DOS read-only and directory bits, when decoded, then names them', () => {
    expect(externalAttributes(0x11, 0)).toEqual({
      raw: 0x11,
      dos: ['read-only', 'directory'],
      unixMode: null,
    });
  });

  it('FLD-7: given a UNIX host and mode 0o100644, when decoded, then -rw-r--r--', () => {
    expect(externalAttributes(0o100644 * 0x10000, 3).unixMode).toBe('-rw-r--r--');
  });

  it('FLD-7: given a UNIX directory 0o40755, when decoded, then drwxr-xr-x', () => {
    expect(externalAttributes(0o40755 * 0x10000 + 0x10, 3)).toMatchObject({
      dos: ['directory'],
      unixMode: 'drwxr-xr-x',
    });
  });

  it('FLD-7: given a UNIX symlink 0o120777, when decoded, then lrwxrwxrwx', () => {
    expect(externalAttributes(0o120777 * 0x10000, 3).unixMode).toBe('lrwxrwxrwx');
  });
});
