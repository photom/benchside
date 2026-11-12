import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { XmlDocument, XmlElement, XmlFinding } from './reader.ts';
import { XmlReader } from './reader.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (string | number[] | Uint8Array)[]) => {
  const arrays = parts.map((p) =>
    typeof p === 'string' ? utf8(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const utf16le = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 255;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
};

/** Reads the input in chunks of `size` bytes (whole when omitted). */
function read(input: Uint8Array, size = input.length || 1) {
  const reader = new XmlReader();
  const documents: XmlDocument[] = [];
  let stop: XmlFinding | null = null;
  for (let at = 0; at < input.length && !stop; at += size) {
    const out = reader.push(input.subarray(at, at + size));
    documents.push(...out.documents);
    stop = out.stop;
  }
  if (!stop) {
    const out = reader.end();
    documents.push(...out.documents);
    stop = out.stop;
  }
  return { documents, stop };
}
const root = (input: Uint8Array) => {
  const r = read(input);
  expect(r.stop).toBeNull();
  return r.documents[0]?.root as XmlElement;
};

describe('XML reader: decoding', () => {
  it('XML-1: given a UTF-8 BOM, when read, then the text is UTF-8', () => {
    expect(root(bytes([0xef, 0xbb, 0xbf], '<a>é</a>')).text).toBe('é');
  });

  it('XML-1: given a UTF-16LE BOM, when read, then names and text are UTF-16', () => {
    const r = root(bytes([0xff, 0xfe], utf16le('<feedback>é</feedback>')));
    expect([r.local, r.text]).toEqual(['feedback', 'é']);
  });

  it('XML-1: given a declared ISO-8859-1 encoding, when read, then byte E9 is é', () => {
    expect(root(bytes('<?xml version="1.0" encoding="ISO-8859-1"?><a>', [0xe9], '</a>')).text).toBe(
      'é',
    );
  });

  it('XML-1: given a declared label TextDecoder does not know, when read, then encoding error and no document', () => {
    const r = read(bytes('<?xml version="1.0" encoding="x-unknown"?><a/>'));
    expect(r.documents).toEqual([]);
    expect(r.stop).toMatchObject({ id: 'aggregate.xml.encoding', severity: 'error' });
  });

  it('XML-2: given invalid UTF-8 bytes in two places, when read, then U+FFFD and one encoding warning', () => {
    const r = read(bytes('<a><b>', [0xff], '</b><c>', [0xfe], '</c></a>'));
    const doc = r.documents[0] as XmlDocument;
    expect(doc.root.children.map((c) => c.text)).toEqual(['�', '�']);
    expect(doc.findings).toEqual([
      expect.objectContaining({ id: 'aggregate.xml.encoding', severity: 'warning' }),
    ]);
  });

  it('XML-2: given CR LF and lone CR line ends, when read, then lines count both', () => {
    const r = root(bytes('<a>\r\n<b/>\r<c/></a>'));
    expect(r.children.map((c) => c.line)).toEqual([2, 3]);
  });
});

describe('XML reader: markup', () => {
  it('XML-3: given comments, processing instructions, CDATA, and attributes, when read, then CDATA joins the text', () => {
    const r = root(
      bytes('<?xml version="1.0"?><!-- c --><a x="1"><?pi d?>t<![CDATA[<u>]]><!--x-->v</a>'),
    );
    expect(r.text).toBe('t<u>v');
  });

  it('XML-4: given a document type declaration, when read, then doctype error and no document', () => {
    const r = read(bytes('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'));
    expect(r.documents).toEqual([]);
    expect(r.stop).toMatchObject({ id: 'aggregate.xml.doctype', severity: 'error' });
  });

  it('XML-5: given the predefined entities and character references, when read, then they are replaced', () => {
    expect(root(bytes('<a>&lt;&gt;&amp;&apos;&quot;&#65;&#x42;</a>')).text).toBe('<>&\'"AB');
  });

  it('XML-5: given another entity or a reference to a code point XML does not allow, when read, then malformed', () => {
    expect(read(bytes('<a>&nbsp;</a>')).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
    expect(read(bytes('<a>&#0;</a>')).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });

  it('XML-6: given an end tag that does not match, when read, then malformed with line and column', () => {
    expect(read(bytes('<a>\n  <b></c></a>')).stop).toMatchObject({
      id: 'aggregate.xml.malformed',
      severity: 'error',
      line: 2,
      column: 6,
    });
  });

  it('XML-6: given an element left open at the end, when read, then malformed', () => {
    expect(read(bytes('<a><b>')).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });

  it('XML-6: given an unquoted, a repeated, or a <-containing attribute, when read, then malformed', () => {
    for (const s of ['<a x=1/>', '<a x="1" x="2"/>', '<a x="<"/>']) {
      expect(read(bytes(s)).stop, s).toMatchObject({ id: 'aggregate.xml.malformed' });
    }
  });

  it('XML-6: given text outside the root, when read, then malformed', () => {
    expect(read(bytes('x<a/>')).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });

  it('XML-6: given nesting deeper than 32, when read, then malformed; 32 is fine', () => {
    const nest = (n: number) => '<e>'.repeat(n) + '</e>'.repeat(n);
    expect(read(bytes(nest(32))).stop).toBeNull();
    expect(read(bytes(nest(33))).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });
});

describe('XML reader: names and tree', () => {
  it('XML-7: given default and prefixed namespaces, when read, then each element has its URI and local name', () => {
    const r = root(
      bytes('<feedback xmlns="urn:a" xmlns:x="urn:x"><x:ext><y/></x:ext><z xmlns=""/></feedback>'),
    );
    expect([r.ns, r.local]).toEqual(['urn:a', 'feedback']);
    const ext = r.children[0] as XmlElement;
    expect([ext.ns, ext.prefix, ext.local]).toEqual(['urn:x', 'x', 'ext']);
    expect(ext.children[0]?.ns).toBe('urn:a');
    expect(r.children[1]?.ns).toBeNull();
  });

  it('XML-7: given an unbound prefix, when read, then malformed', () => {
    expect(read(bytes('<x:a/>')).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });

  it('XML-7: given lang and xml:lang attributes, when read, then only the unprefixed lang is read', () => {
    const r = root(bytes('<a><b lang="de"/><c xml:lang="fr"/></a>'));
    expect(r.children.map((c) => c.lang)).toEqual(['de', null]);
  });

  it('XML-8, XML-9: given text around child elements and padded text, when read, then the mixed text is ignored and the rest trimmed', () => {
    const r = root(bytes('<a>  x <b>\n  y \t</b> z</a>'));
    expect(r.text).toBe('');
    expect(r.children[0]?.text).toBe('y');
  });
});

describe('XML reader: several documents (XML-10)', () => {
  it('XML-10: given two documents joined, with a declaration and comments between, when read, then two documents', () => {
    const r = read(bytes('<a>1</a>\n<!-- x -->\n<?xml version="1.0"?><b>2</b>'));
    expect(r.stop).toBeNull();
    expect(r.documents.map((d) => d.root.text)).toEqual(['1', '2']);
  });

  it('XML-10: given a later UTF-8 document with a BOM after a UTF-8 one, when read, then both are read', () => {
    const r = read(bytes('<a/>', [0xef, 0xbb, 0xbf], '<b/>'));
    expect(r.documents.map((d) => d.root.local)).toEqual(['a', 'b']);
  });

  it('XML-10: given a later document that declares another encoding, when read, then encoding error and the first stays', () => {
    const r = read(bytes('<a/><?xml version="1.0" encoding="ISO-8859-1"?><b/>'));
    expect(r.documents.map((d) => d.root.local)).toEqual(['a']);
    expect(r.stop).toMatchObject({ id: 'aggregate.xml.encoding', severity: 'error' });
  });

  it('XML-10: given a UTF-16 BOM after a UTF-8 document, when read, then encoding error', () => {
    const r = read(bytes('<a/>', [0xff, 0xfe], utf16le('<b/>')));
    expect(r.documents.length).toBe(1);
    expect(r.stop).toMatchObject({ id: 'aggregate.xml.encoding' });
  });

  it('XML-10: given a later document without a declared encoding after an ISO-8859-1 one, when read, then it counts as UTF-8 and fails', () => {
    const r = read(
      bytes('<?xml version="1.0" encoding="ISO-8859-1"?><a/><?xml version="1.0"?><b/>'),
    );
    expect(r.documents.length).toBe(1);
    expect(r.stop).toMatchObject({ id: 'aggregate.xml.encoding' });
  });

  it('XML-10: given a malformed second document, when read, then the first stays', () => {
    const r = read(bytes('<a/><b>'));
    expect(r.documents.map((d) => d.root.local)).toEqual(['a']);
    expect(r.stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });
});

describe('XML reader: review cases', () => {
  it('XML-1: given a UTF-8 BOM cut after two bytes, when read in chunks, then it is still a BOM', () => {
    const reader = new XmlReader();
    expect(reader.push(Uint8Array.of(0xef, 0xbb)).stop).toBeNull();
    const out = reader.push(bytes([0xbf], '<a>x</a>'));
    expect(out.stop).toBeNull();
    expect(out.documents[0]?.root.text).toBe('x');
  });

  it('XML-1: given a declared UTF-16 without a BOM, when read, then the ASCII-readable bytes are UTF-8', () => {
    expect(root(bytes('<?xml version="1.0" encoding="UTF-16"?><feedback>a</feedback>')).local).toBe(
      'feedback',
    );
  });

  it('XML-1: given a declared encoding that is not ASCII-compatible, when read, then encoding error', () => {
    expect(read(bytes('<?xml version="1.0" encoding="ISO-2022-JP"?><a/>')).stop).toMatchObject({
      id: 'aggregate.xml.encoding',
      severity: 'error',
    });
  });

  it('XML-2: given a lone surrogate in the second of two UTF-16 documents, when read at once, then only the second gets the warning', () => {
    const r = read(
      bytes(
        [0xff, 0xfe],
        utf16le(`<a>1</a>${String.fromCharCode(0xfeff)}<b>${String.fromCharCode(0xd800)}</b>`),
      ),
    );
    expect(r.documents.map((d) => d.findings.length)).toEqual([0, 1]);
  });

  it('XML-2, XML-5: given a character reference to CR, when read, then it stays CR', () => {
    expect(root(bytes('<a>x&#13;y</a>')).text).toBe('x\ry');
  });

  it('XML-6: given an XML declaration after a comment at the start, when read, then malformed', () => {
    expect(read(bytes('<!--c--><?xml version="1.0"?><a/>')).stop).toMatchObject({
      id: 'aggregate.xml.malformed',
    });
  });

  it('XML-6: given input with no root element, when it ends, then malformed', () => {
    expect(read(bytes('  <!-- only a comment -->')).stop).toMatchObject({
      id: 'aggregate.xml.malformed',
    });
  });

  it('INP-6: given a document past the size limit, when read, then too-large and reading stops', () => {
    const reader = new XmlReader({ maxDocument: 1000 });
    const out = reader.push(bytes('<a/><b>', 'x'.repeat(2000), '</b>'));
    expect(out.documents.map((d) => d.root.local)).toEqual(['a']);
    expect(out.stop).toMatchObject({ id: 'aggregate.input.too-large', severity: 'error' });
  });

  it('PRG-8: given a long text node in many small chunks, when read, then the work stays linear', () => {
    const input = bytes('<a>', 'x'.repeat(4_000_000), '</a>');
    const start = performance.now();
    const r = read(input, 4096);
    expect(r.documents[0]?.root.text.length).toBe(4_000_000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe('XML reader: post-merge review cases', () => {
  it('XML-10: given two identical UTF-16 documents with BOMs and declarations, when read, then both are read', () => {
    const doc = bytes([0xff, 0xfe], utf16le('<?xml version="1.0"?><a/>'));
    expect(read(bytes(doc, doc)).documents.length).toBe(2);
  });

  it('XML-10: given a declared UTF-16 without a BOM, twice, when read, then both are read as UTF-8', () => {
    const doc = '<?xml version="1.0" encoding="UTF-16"?><a/>';
    expect(read(bytes(doc, doc)).documents.length).toBe(2);
  });

  it('XML-8: given a value that starts with U+FEFF, when read, then the character stays', () => {
    expect(root(bytes('<a>', [0xef, 0xbb, 0xbf], 'x</a>')).text.length).toBe(2);
  });

  it('XML-10: given two BOMs, or a BOM after the declaration, before a later document, when read, then malformed', () => {
    const bom = [0xef, 0xbb, 0xbf];
    expect(read(bytes('<a/>', bom, bom, '<b/>')).stop).toMatchObject({
      id: 'aggregate.xml.malformed',
    });
    expect(read(bytes('<a/><?xml version="1.0"?>', bom, '<b/>')).stop).toMatchObject({
      id: 'aggregate.xml.malformed',
    });
  });

  it('INP-6: given a document whose closing tag crosses the size limit, when read, then too-large', () => {
    const reader = new XmlReader({ maxDocument: 20 });
    const out = reader.push(bytes('<feedback>12</feedback>'));
    expect(out.documents).toEqual([]);
    expect(out.stop).toMatchObject({ id: 'aggregate.input.too-large' });
  });

  it('XML-1, XML-6: given an XML declaration longer than 1024 bytes, when read, then malformed', () => {
    const decl = `<?xml version="1.0"${' '.repeat(1100)}encoding="windows-1252"?><a/>`;
    expect(read(bytes(decl)).stop).toMatchObject({ id: 'aggregate.xml.malformed' });
  });
});

describe('XML reader: chunks and broken input', () => {
  const samples = [
    bytes(
      '<?xml version="1.0" encoding="UTF-8"?>\r\n<feedback xmlns="urn:x"><r a="&amp;">é&#x41;<![CDATA[z]]></r></feedback><b/>',
    ),
    bytes([0xff, 0xfe], utf16le('<a x="1">é</a>')),
    bytes('<?xml version="1.0" encoding="ISO-8859-1"?><a>', [0xe9], '</a>'),
  ];

  it('given the same input in chunks of 1, 2, 3, and 7 bytes, when read, then the result equals reading it whole', () => {
    for (const input of samples) {
      const whole = read(input);
      for (const size of [1, 2, 3, 7]) expect(read(input, size)).toEqual(whole);
    }
  });

  it('given truncated and mutated documents, when read, then it never throws', () => {
    let seed = 3;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 4;
    };
    for (const base of samples) {
      for (let n = 0; n < 300; n++) {
        const input = base.slice(0, rand() % (base.length + 1));
        for (let k = 0; k < 3; k++) if (input.length) input[rand() % input.length] = rand() & 255;
        expect(() => read(input, 1 + (rand() % 9))).not.toThrow();
      }
    }
  });
});

describe('XML reader: digests (XML-11)', () => {
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

  it('XML-11: given two documents, when read, then each digest covers its bytes up to the end of its root', () => {
    const r = read(bytes('<?xml version="1.0"?>\n<a>1</a>', '\n<!-- c --><b/>', '\n'));
    expect(r.documents.map((d) => d.digest)).toEqual([
      sha(utf8('<?xml version="1.0"?>\n<a>1</a>')),
      sha(utf8('<b/>')),
    ]);
  });

  it('XML-11: given a report alone and the same report after another one, when read, then the digests are equal', () => {
    const doc = '<?xml version="1.0"?>\n<r><x>1</x></r>';
    const alone = read(bytes(doc, '\n')).documents[0]?.digest;
    expect(read(bytes('<a/>\n', doc, '\n')).documents[1]?.digest).toBe(alone);
    const root = '<r><x>1</x></r>';
    expect(read(bytes('\n<!-- c -->\n', root)).documents[0]?.digest).toBe(sha(utf8(root)));
  });

  it('XML-11: given the same input in chunks of 1, 3, and 7 bytes, when read, then the digests are the same', () => {
    const input = bytes('<a>', 'x'.repeat(300), '</a><b><c/></b>');
    const want = read(input).documents.map((d) => d.digest);
    for (const size of [1, 3, 7])
      expect(read(input, size).documents.map((d) => d.digest)).toEqual(want);
  });

  it('XML-11: given a BOM at the start, when read, then the digest leaves it out', () => {
    expect(read(bytes([0xef, 0xbb, 0xbf], '<a/>')).documents[0]?.digest).toBe(sha(utf8('<a/>')));
  });

  it('XML-11: given UTF-16 input, when read, then the digest is of the transcoded UTF-8', () => {
    const text = `<a>${String.fromCharCode(0xe9)}</a>`;
    expect(read(bytes([0xff, 0xfe], utf16le(text))).documents[0]?.digest).toBe(sha(utf8(text)));
  });

  it('XML-11: given documents before an error, when read, then they keep their digests', () => {
    const r = read(bytes('<a/>', '<b>'));
    expect(r.stop?.id).toBe('aggregate.xml.malformed');
    expect(r.documents.map((d) => d.digest)).toEqual([sha(utf8('<a/>'))]);
  });
});

describe('XML reader: size per document (INP-6)', () => {
  it('INP-6: given two documents each under the limit but over it together, when read, then both are read', () => {
    const doc = `<a>${'x'.repeat(600)}</a>`;
    const reader = new XmlReader({ maxDocument: 1000 });
    const out = [reader.push(utf8(doc + doc)), reader.end()];
    expect(out.flatMap((o) => o.documents)).toHaveLength(2);
    expect(out.map((o) => o.stop)).toEqual([null, null]);
  });
});
