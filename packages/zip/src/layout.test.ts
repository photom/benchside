import { describe, expect, it } from 'vitest';
import { analyzeZip } from './analyze.ts';
import { regionFields } from './layout.ts';
import { bytesSource } from './source.ts';
import { buildZip, extraBlock, type FixtureEntry, Writer } from './test/build-zip.ts';
import type { Region, RegionKind, ZipReport } from './types.ts';

const analyze = async (entries: FixtureEntry[], options = {}) => {
  const z = buildZip(entries, options);
  return { z, report: await analyzeZip(bytesSource(z.bytes)) };
};
const regionOf = (r: ZipReport, kind: RegionKind) =>
  r.regions.find((g) => g.kind === kind) as Region;
/** [name, offset relative to the region, length] */
const fields = (r: ZipReport, region: Region) =>
  regionFields(r, region).map((f) => [f.name, f.offset - region.offset, f.byteLength]);

const ut = extraBlock(0x5455, new Writer().u8(1).u32(1735787045).done());

describe('field layouts', () => {
  it('REQ-ZIP-009, HEX-6, HEX-10: given a central header, when laid out, then the 17 fixed fields, the name, each extra block, and the comment', async () => {
    const { report } = await analyze([{ name: 'a.txt', comment: 'c', centralExtra: ut }]);
    expect(fields(report, regionOf(report, 'central-header'))).toEqual([
      ['central file header signature', 0, 4],
      ['version made by', 4, 2],
      ['version needed to extract', 6, 2],
      ['general purpose bit flag', 8, 2],
      ['compression method', 10, 2],
      ['last mod file time', 12, 2],
      ['last mod file date', 14, 2],
      ['crc-32', 16, 4],
      ['compressed size', 20, 4],
      ['uncompressed size', 24, 4],
      ['file name length', 28, 2],
      ['extra field length', 30, 2],
      ['file comment length', 32, 2],
      ['disk number start', 34, 2],
      ['internal file attributes', 36, 2],
      ['external file attributes', 38, 4],
      ['relative offset of local header', 42, 4],
      ['file name', 46, 5],
      ['extra 0x5455 Extended timestamp: header ID', 51, 2],
      ['extra 0x5455 Extended timestamp: data size', 53, 2],
      ['extra 0x5455 Extended timestamp: data', 55, 5],
      ['file comment', 60, 1],
    ]);
  });

  it('HEX-6: given a local header with no extra field, when laid out, then the 11 fixed fields and the name', async () => {
    const { report } = await analyze([{ name: 'ab', content: 'x' }]);
    expect(fields(report, regionOf(report, 'local-header'))).toEqual([
      ['local file header signature', 0, 4],
      ['version needed to extract', 4, 2],
      ['general purpose bit flag', 6, 2],
      ['compression method', 8, 2],
      ['last mod file time', 10, 2],
      ['last mod file date', 12, 2],
      ['crc-32', 14, 4],
      ['compressed size', 18, 4],
      ['uncompressed size', 22, 4],
      ['file name length', 26, 2],
      ['extra field length', 28, 2],
      ['file name', 30, 2],
    ]);
  });

  it('HEX-10: given zero padding in a local header, when laid out, then it is one field', async () => {
    const { report } = await analyze([{ name: 'a', content: 'x', localExtra: new Uint8Array(3) }]);
    expect(fields(report, regionOf(report, 'local-header')).slice(-1)).toEqual([
      ['Zero padding', 31, 3],
    ]);
  });

  it('HEX-6: given an EOCD with a comment, when laid out, then the 8 fixed fields and the comment', async () => {
    const { report } = await analyze([{ name: 'a' }], { comment: 'hi' });
    expect(fields(report, regionOf(report, 'eocd'))).toEqual([
      ['end of central dir signature', 0, 4],
      ['number of this disk', 4, 2],
      ['number of the disk with the start of the central directory', 6, 2],
      ['total number of entries in the central directory on this disk', 8, 2],
      ['total number of entries in the central directory', 10, 2],
      ['size of the central directory', 12, 4],
      ['offset of start of central directory', 16, 4],
      ['.ZIP file comment length', 20, 2],
      ['.ZIP file comment', 22, 2],
    ]);
  });

  it('HEX-6: given ZIP64 end records, when laid out, then the record and locator fields', async () => {
    const { report } = await analyze([{ name: 'a' }], { zip64: true });
    expect(fields(report, regionOf(report, 'zip64-eocd')).map(([, o, l]) => [o, l])).toEqual([
      [0, 4],
      [4, 8],
      [12, 2],
      [14, 2],
      [16, 4],
      [20, 4],
      [24, 8],
      [32, 8],
      [40, 8],
      [48, 8],
    ]);
    expect(fields(report, regionOf(report, 'zip64-locator'))).toEqual([
      ['zip64 end of central dir locator signature', 0, 4],
      ['number of the disk with the start of the zip64 end of central directory', 4, 4],
      ['relative offset of the zip64 end of central directory record', 8, 8],
      ['total number of disks', 16, 4],
    ]);
  });

  it('HEX-6: given signed, unsigned, and ZIP64 data descriptors, when laid out, then the fields of each', async () => {
    const { report } = await analyze([
      { name: 'a', content: 'abc', descriptor: 'signed' },
      { name: 'b', content: 'de', descriptor: 'unsigned' },
      { name: 'c', content: 'f', descriptor: 'signed', zip64: true },
    ]);
    const descriptors = report.regions.filter((g) => g.kind === 'data-descriptor');
    expect(descriptors.map((d) => fields(report, d))).toEqual([
      [
        ['signature', 0, 4],
        ['crc-32', 4, 4],
        ['compressed size', 8, 4],
        ['uncompressed size', 12, 4],
      ],
      [
        ['crc-32', 0, 4],
        ['compressed size', 4, 4],
        ['uncompressed size', 8, 4],
      ],
      [
        ['signature', 0, 4],
        ['crc-32', 4, 4],
        ['compressed size', 8, 8],
        ['uncompressed size', 16, 8],
      ],
    ]);
  });

  it('HEX-6: given a digital signature record, when laid out, then its three fields', async () => {
    const z = buildZip([{ name: 'a' }], {
      afterCentral: new Writer().u32(0x05054b50).u16(3).bytes('sig').done(),
    });
    const view = new DataView(z.bytes.buffer);
    view.setUint32(z.eocdOffset + 12, z.cdByteLength + 9, true);
    const report = await analyzeZip(bytesSource(z.bytes));
    expect(fields(report, regionOf(report, 'digital-signature'))).toEqual([
      ['header signature', 0, 4],
      ['size of data', 4, 2],
      ['signature data', 6, 3],
    ]);
  });

  it('HEX-7: given a central header, when laid out, then only number fields are marked numeric', async () => {
    const { report } = await analyze([{ name: 'a.txt', comment: 'c', centralExtra: ut }]);
    const numeric = Object.fromEntries(
      regionFields(report, regionOf(report, 'central-header')).map((f) => [f.name, f.numeric]),
    );
    expect(numeric).toMatchObject({
      'crc-32': true,
      'file name': false,
      'extra 0x5455 Extended timestamp: header ID': true,
      'extra 0x5455 Extended timestamp: data size': true,
      'extra 0x5455 Extended timestamp: data': false,
      'file comment': false,
    });
  });

  it('HEX-6: given file data, when laid out, then no fields', async () => {
    const { report } = await analyze([{ name: 'a', content: 'abc' }]);
    expect(fields(report, regionOf(report, 'file-data'))).toEqual([]);
  });

  it('HEX-11: given a region shorter than its layout, when laid out, then fields stop at its end', async () => {
    const { report } = await analyze([{ name: 'a.txt' }]);
    const region = { ...regionOf(report, 'central-header'), byteLength: 11 };
    expect(fields(report, region)).toEqual([
      ['central file header signature', 0, 4],
      ['version made by', 4, 2],
      ['version needed to extract', 6, 2],
      ['general purpose bit flag', 8, 2],
      ['compression method', 10, 1],
    ]);
  });
});
