import {describe, expect, test} from 'bun:test';
import {shouldTransformId} from '../../src/id';
import type {MarkdocVitePluginOptions} from '../../src/types';

describe('shouldTransformId', () => {
  // [名前, id, 期待値, オプション]
  const cases: [string, string, boolean, MarkdocVitePluginOptions?][] = [
    ['matches .md', '/x/page.md', true],
    ['matches .mdoc', '/x/page.mdoc', true],
    ['rejects .mdx', '/x/page.mdx', false],
    ['rejects ?raw', '/x/page.md?raw', false],
    ['rejects node_modules', '/x/node_modules/pkg/readme.md', false],
    ['custom extensions', '/x/page.markdown', true, {extensions: ['.markdown']}],
    ['official extension regex', '/x/page.markdown', true, {extension: /\.(markdown|mdx)$/}],
    ['rejects \\0 virtual id', '\0/x/page.md', false],
    ['accepts ?import (dev client)', '/x/page.md?import', true],
    ['accepts ?t= timestamp', '/x/page.md?t=1700000000000', true],
    ['accepts ?v= hash', '/x/page.md?v=abc123', true],
    ['rejects ?url', '/x/page.md?url', false],
    ['rejects ?raw among other params', '/x/page.md?foo=1&raw', false],
    ['rejects ?inline', '/x/page.md?inline', false],
    ['rejects ?worker', '/x/page.md?worker', false],
    ['rejects ?html-proxy', '/x/page.md?html-proxy&index=0.js', false],
    ['accepts a #hash', '/x/page.md#section', true],
    ['accepts ?t= followed by a #hash', '/x/page.md?t=1#section', true],
    ['rejects ?raw followed by a #hash', '/x/page.md?raw#section', false],
    ['accepts uppercase .MD', '/x/PAGE.MD', true],
    ['accepts Windows-style id C:/x/pages/a.md', 'C:/x/pages/a.md', true],
    ['rejects Windows node_modules id', 'C:\\x\\node_modules\\pkg\\a.md', false],
    ['node_modules is matched as a segment', '/home/u/my_node_modules_backup/site/pages/a.md', true],
  ];
  for (const [name, id, expected, options] of cases) {
    test(name, () => {
      expect(shouldTransformId(id, options)).toBe(expected);
    });
  }

  test('extension regex with /g is stable across calls', () => {
    // /g の lastIndex が呼び出し間で残ると交互に失敗する
    const options = {extension: /\.md$/g};
    const results = [1, 2, 3, 4].map(() => shouldTransformId('/x/a.md', options));
    expect(results).toEqual([true, true, true, true]);
  });
});
