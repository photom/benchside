import { describe, expect, it } from 'vitest';
import { MAX_TEXT } from './text.ts';
import { findXfaScripts } from './xfa.ts';

const scan = (xml: string, max?: number) => findXfaScripts(xml, max).scripts;
const texts = (xml: string) => scan(xml).map((s) => s.text.text);

describe('XFA scripts', () => {
  it('SCR-4: given a script in an event, when scanned, then its text, contentType, and activity', () => {
    const xml =
      '<template><field name="a"><event activity="initialize" name="e">' +
      '<script contentType="application/x-javascript">app.alert(1);</script>' +
      '</event></field></template>';
    expect(scan(xml)).toEqual([
      {
        language: 'application/x-javascript',
        event: 'initialize',
        text: { text: 'app.alert(1);', truncated: false },
        byteLength: 13,
        offset: 64,
      },
    ]);
  });

  it('SCR-4: given a prefixed script with no contentType outside any event, when scanned, then an empty language and no event', () => {
    const [s] = scan('<x:template><x:script>a=1</x:script></x:template>');
    expect(s).toEqual({
      language: '',
      text: { text: 'a=1', truncated: false },
      byteLength: 3,
      offset: 12,
    });
  });

  it('SCR-4: given an event closed before the script, when scanned, then no event', () => {
    const xml = '<event activity="click"><x/></event><script>b()</script>';
    expect(scan(xml)[0]?.event).toBeUndefined();
  });

  it('SCR-4: given nested events, when scanned, then the nearest open one', () => {
    const xml =
      '<event activity="outer"><event activity="inner"></event>' +
      '<script>c()</script></event><event activity="later"><script>d()</script></event>';
    expect(scan(xml).map((s) => s.event)).toEqual(['outer', 'later']);
  });

  it('SCR-4: given a script in a comment or a CDATA section, when scanned, then it is not listed', () => {
    const xml =
      '<!-- <script>no()</script> --><![CDATA[<script>no()</script>]]><script>yes()</script>';
    expect(texts(xml)).toEqual(['yes()']);
  });

  it('SCR-4: given empty, self-closing, and unclosed scripts, when scanned, then none are listed', () => {
    expect(scan('<script/><script></script><script >x')).toEqual([]);
  });

  it('SCR-4: given names that only start with script, when scanned, then they are not scripts', () => {
    expect(scan('<scripts>a</scripts><scriptX>b</scriptX><x:scripting>c</x:scripting>')).toEqual(
      [],
    );
  });

  it('SCR-4: given ">" inside an attribute value, when scanned, then the tag ends after the quotes', () => {
    expect(scan('<script contentType="a>b">e()</script>')[0]).toMatchObject({
      language: 'a>b',
      text: { text: 'e()' },
    });
  });

  it('SCR-4: given an end tag with another prefix, when scanned, then the script runs to its own end tag', () => {
    expect(texts('<a:script>1</b:script>2</a:script>')).toEqual(['1</b:script>2']);
  });

  it('SCR-5: given entities, character references, and CDATA, when scanned, then they are decoded', () => {
    const xml =
      '<script>if (a &lt; b &amp;&amp; c &gt; d) &quot;&apos;&#65;&#x42;&nbsp;' +
      '<![CDATA[x < y && "</script>"]]></script>';
    expect(texts(xml)).toEqual([`if (a < b && c > d) "'AB&nbsp;x < y && "</script>"`]);
  });

  it('SCR-5: given character references outside Unicode, when scanned, then they are kept as written', () => {
    expect(texts('<script>&#x110000;&#xD800;&#99999999999;</script>')).toEqual([
      '&#x110000;&#xD800;&#99999999999;',
    ]);
  });

  it('SCR-5: given non-ASCII content, when scanned, then byteLength counts UTF-8 bytes', () => {
    const eAcute = String.fromCharCode(0xe9);
    expect(scan(`<script>${eAcute}</script>`)[0]?.byteLength).toBe(2);
  });

  it('SCR-5: given a script longer than the text limit, when scanned, then it is cut', () => {
    const [s] = scan(`<script>${'a'.repeat(MAX_TEXT + 5)}</script>`);
    expect(s?.text).toEqual({ text: 'a'.repeat(MAX_TEXT), truncated: true });
    expect(s?.byteLength).toBe(MAX_TEXT + 5);
  });

  it('SCR-10: given more scripts than asked for, when scanned, then it stops at the limit', () => {
    expect(scan('<script>1</script><script>2</script><script>3</script>', 2)).toHaveLength(2);
  });

  it('SCR-4: given an attribute name inside another attribute value, when scanned, then the real attributes count', () => {
    const xml =
      `<event x=" activity='docClose'" activity="initialize">` +
      `<script a=" contentType='text/plain'" contentType="application/x-javascript">s()</script></event>`;
    expect(scan(xml).map((s) => [s.event, s.language])).toEqual([
      ['initialize', 'application/x-javascript'],
    ]);
  });

  it('SCR-4: given a tag with an unclosed quote, when scanned, then it is skipped and later scripts are listed', () => {
    expect(texts("<x a='><script>ok()</script>")).toEqual(['ok()']);
  });

  it('SCR-4: given many script tags with different prefixes and no end tags, when scanned, then it stops early and says so', () => {
    let xml = '';
    for (let i = 0; i < 100_000; i++) xml += `<a${i}:script>`;
    const start = performance.now();
    const result = findXfaScripts(xml);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(result).toEqual({ scripts: [], complete: false });
  });

  it('SCR-4: given ordinary XML, when scanned, then the scan is complete', () => {
    expect(findXfaScripts('<a><script>x</script></a>').complete).toBe(true);
  });

  it('REQ-PDF-003: given many unclosed tags and comments, when scanned, then it ends quickly', () => {
    const xml = `${'<script>'.repeat(20_000)}${'<!--'.repeat(20_000)}${'<event activity="x">'.repeat(20_000)}`;
    const start = performance.now();
    expect(scan(xml)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
