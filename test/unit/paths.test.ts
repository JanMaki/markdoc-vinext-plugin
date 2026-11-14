import {describe, expect, test} from 'bun:test';
import path from 'node:path';
import {getRelativeImportPath, isInside, isTooBroadToAllow} from '../../src/paths';

describe('isInside', () => {
  for (const [label, dir, file, expected, impl] of [
    ['equal directory', '/p/markdoc', '/p/markdoc', true, path.posix],
    ['child file', '/p/markdoc', '/p/markdoc/x/y.md', true, path.posix],
    ['sibling with the same prefix', '/p/markdoc', '/p/markdoc-evil/x', false, path.posix],
    ['parent directory', '/p/markdoc', '/p', false, path.posix],
    ['file named "..foo" inside', '/p', '/p/..foo', true, path.posix],
    ['".." segment escaping after normalization', '/p/a', '/p/a/../b', false, path.posix],
    ['win32 child', 'C:\\p', 'C:\\p\\x.md', true, path.win32],
    ['win32 drive-letter case differs', 'c:\\p', 'C:\\p\\x.md', true, path.win32],
    ['win32 cross-drive', 'C:\\p', 'D:\\p\\x.md', false, path.win32],
    ['win32 sibling with the same prefix', 'C:\\p\\markdoc', 'C:\\p\\markdoc-evil\\x', false, path.win32],
    ['win32 forward slashes', 'C:/p', 'C:\\p\\x.md', true, path.win32],
  ] as const) {
    test(label, () => {
      expect(isInside(dir, file, impl)).toBe(expected);
    });
  }
});

describe('isTooBroadToAllow', () => {
  const root = path.parse(process.cwd()).root;
  const home = path.join(root, 'home', 'me');

  test('filesystem root, home and its ancestors are too broad; other directories are not', () => {
    expect(isTooBroadToAllow(root, home)).toBe(true);
    expect(isTooBroadToAllow(home, home)).toBe(true);
    expect(isTooBroadToAllow(path.join(root, 'home'), home)).toBe(true);
    expect(isTooBroadToAllow(path.join(home, 'shared'), home)).toBe(false);
    expect(isTooBroadToAllow(path.join(root, 'srv'), home)).toBe(false);
  });
});

describe('getRelativeImportPath', () => {
  for (const [label, from, to, expected, impl] of [
    ['posix relative import', '/p/pages/a.md', '/p/markdoc/tags.ts', '../markdoc/tags.ts', path.posix],
    ['posix sibling directory gets ./', '/p/a.md', '/p/markdoc/tags.ts', './markdoc/tags.ts', path.posix],
    ['posix same-directory file gets ./', '/p/a.md', '/p/tags.ts', './tags.ts', path.posix],
    ['target equal to the importer directory → ./', '/p/a.md', '/p', './', path.posix],
    [
      'win32 same drive → forward slashes',
      'C:\\p\\pages\\a.md',
      'C:\\p\\markdoc\\tags.ts',
      '../markdoc/tags.ts',
      path.win32,
    ],
    ['win32 cross-drive → absolute D:/s/tags.ts', 'C:\\p\\pages\\a.md', 'D:\\s\\tags.ts', 'D:/s/tags.ts', path.win32],
  ] as const) {
    test(label, () => {
      expect(getRelativeImportPath(from, to, impl)).toBe(expected);
    });
  }
});
