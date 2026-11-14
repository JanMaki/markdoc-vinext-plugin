import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {constValue} from '../helpers/ast';
import {canSymlink, trySymlink, writeFile, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {expectThrowMessage, fixtureTransform} from '../helpers/transform';

const dir = tmpDirFor(import.meta);
const fx = path.join(dir, 'project');
const partials = path.join(fx, 'markdoc/partials');
const transform = fixtureTransform(fx);
const win = process.platform === 'win32';
const SECRET = 'do-not-leak';

// skipIf の判定に使うため、収集時に作成する。
const symlinks = canSymlink(dir);
const sharedPartials = path.join(dir, 'shared-partials');
const linkedRoot = path.join(dir, 'linked');
writeFile(path.join(sharedPartials, 'ok.md'), 'SHARED-PARTIAL\n');
fs.mkdirSync(path.join(linkedRoot, 'markdoc'), {recursive: true});
const linkedPartials = trySymlink(sharedPartials, path.join(linkedRoot, 'markdoc/partials'), 'junction');
// ホームディレクトリ等の広いフォルダの代わり。
const broadDir = path.join(dir, 'broad');
writeFile(path.join(broadDir, 'inner.md'), `${SECRET}\n`);
fs.mkdirSync(partials, {recursive: true});
const linkedBroad = trySymlink(broadDir, path.join(partials, 'broad.md'), 'junction');

beforeAll(() => {
  writeTree(fx, {
    '.env': `SECRET_TOKEN=${SECRET}\n`,
    'outside.md': `OUTSIDE-PARTIALS ${SECRET}\n`,
    'markdoc/tags.ts': 'export default {};\n',
    'markdoc/partials/secret.env': `SECRET_TOKEN=${SECRET}\n`,
    'markdoc/partials/upper.MD': 'UPPER-EXTENSION\n',
    'markdoc/partials/dir.md/inner.md': `${SECRET}\n`,
    'markdoc/partials-evil/x.md': `${SECRET}\n`,
  });
  if (symlinks) {
    trySymlink(path.join(fx, 'outside.md'), path.join(partials, 'link.md'));
    trySymlink(path.join(partials, 'secret.env'), path.join(partials, 'sneaky.md'));
  }
});

const OUTSIDE = 'resolves outside the partials directory';
const EXTENSION = 'must have one of these extensions';
const NOT_FOUND = 'was not found';
const ADS = 'NTFS alternate data streams are not allowed';

describe('partials: rejected paths', () => {
  // Windows 以外では `\` と `C:` はファイル名の一部になる。
  for (const [label, file, expected] of [
    ['../../.env', '../../.env', OUTSIDE],
    ['absolute /etc/passwd', '/etc/passwd', OUTSIDE],
    ['../../outside.md (inside the project)', '../../outside.md', OUTSIDE],
    ['backslash ..\\..\\.env', '..\\..\\.env', win ? OUTSIDE : EXTENSION],
    ['drive-absolute C:/x.md', 'C:/x.md', win ? OUTSIDE : NOT_FOUND],
    ['UNC \\\\srv\\s\\x.md', '\\\\srv\\s\\x.md', win ? OUTSIDE : NOT_FOUND],
    ['empty file attribute', '', OUTSIDE],
    ['the partials directory itself (.)', '.', OUTSIDE],
    ['sibling with the same prefix ../partials-evil/x.md', '../partials-evil/x.md', OUTSIDE],
    ['non-Markdown file inside partials/', 'secret.env', EXTENSION],
  ] as const) {
    test(label, async () => {
      const message = await expectThrowMessage(() => transform(`{% partial file=${JSON.stringify(file)} /%}\n`));
      expect(message).toStartWith('[markdoc-vinext] Partial ');
      expect(message).toContain(expected);
      expect(message).not.toContain(SECRET);
    });
  }

  // NTFS の代替データストリーム、末尾の . / 空白、デバイス / 拡張長パスから secret を読めない。
  const WIN_REJECTED = new RegExp(
    [OUTSIDE, EXTENSION, NOT_FOUND, ADS, 'could not be read']
      .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
  );
  for (const file of ['a.md:stream', 'a.md::$DATA', 'a.md.', 'a.md ', '\\\\?\\C:\\x.md', '\\\\.\\C:\\x.md']) {
    test.skipIf(!win)(`Windows path ${JSON.stringify(file)} is rejected without leaking content`, async () => {
      const message = await expectThrowMessage(() => transform(`{% partial file=${JSON.stringify(file)} /%}\n`));
      expect(message).toStartWith('[markdoc-vinext] Partial ');
      expect(message).toMatch(WIN_REJECTED);
      expect(message).not.toContain(SECRET);
    });
  }

  test.skipIf(!win)('an alternate data stream with an allowed extension (ads.txt:s.md) is rejected', async () => {
    fs.writeFileSync(path.join(partials, 'ads.txt'), '');
    fs.writeFileSync(path.join(partials, 'ads.txt:s.md'), `${SECRET}\n`);
    const message = await expectThrowMessage(() => transform('{% partial file="ads.txt:s.md" /%}\n'));
    expect(message).toStartWith('[markdoc-vinext] Partial "ads.txt:s.md" in ');
    expect(message).toContain(ADS);
    expect(message).not.toContain(SECRET);
  });

  test('a directory named dir.md fails without leaking its contents', async () => {
    const message = await expectThrowMessage(() => transform('{% partial file="dir.md" /%}\n'));
    expect(message).toStartWith('[markdoc-vinext] Partial "dir.md" in ');
    expect(message).toContain('could not be read (EISDIR).');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('inner.md');
  });

  test.skipIf(!symlinks)('a symlinked partial escaping partials/ is rejected', async () => {
    const message = await expectThrowMessage(() => transform('{% partial file="link.md" /%}\n'));
    expect(message).toContain('is a symlink to');
    expect(message).toContain('outside the partials directory');
    expect(message).not.toContain(SECRET);
  });

  test.skipIf(!symlinks)('a symlinked .md partial pointing at a .env file inside partials/ is rejected', async () => {
    const message = await expectThrowMessage(() => transform('{% partial file="sneaky.md" /%}\n'));
    expect(message).toContain('does not have one of these extensions');
    expect(message).not.toContain(SECRET);
  });
});

describe('partials: accepted paths', () => {
  const partialsOf = async (source: string, options = {}) =>
    constValue((await transform(source, 'pages/t.md', options)).code, 'partials');

  test('the extension check ignores case (.MD)', async () => {
    expect(await partialsOf('{% partial file="upper.MD" /%}\n')).toEqual({'upper.MD': 'UPPER-EXTENSION\n'});
  });

  test('partialExtensions can opt in other extensions', async () => {
    expect(await partialsOf('{% partial file="secret.env" /%}\n', {partialExtensions: ['.env']})).toEqual({
      'secret.env': `SECRET_TOKEN=${SECRET}\n`,
    });
  });

  test.skipIf(!linkedPartials)('a linked partials directory reads partials under its real path', async () => {
    const linked = fixtureTransform(linkedRoot);
    expect(fs.realpathSync(path.join(linkedRoot, 'markdoc/partials'))).toBe(fs.realpathSync(sharedPartials));
    const {code} = await linked('{% partial file="ok.md" /%}\n');
    expect(constValue(code, 'partials')).toEqual({'ok.md': 'SHARED-PARTIAL\n'});
  });
});

describe('partials: watch files', () => {
  /** 変換の例外を無視し、addWatchFile に渡されたパスを返す。 */
  const watchedBy = async (source: string, root = fx): Promise<string[]> => {
    const watched: string[] = [];
    await expectThrowMessage(() =>
      fixtureTransform(root)(source, 'pages/t.md', {}, {addWatchFile: (f: string) => watched.push(f)}),
    );
    return watched;
  };

  test.skipIf(!linkedBroad)(
    'a partial linked to a directory outside partials/ is rejected and not watched',
    async () => {
      const message = await expectThrowMessage(() => transform('{% partial file="broad.md" /%}\n'));
      expect(message).toContain('outside the partials directory');
      const watched = await watchedBy('{% partial file="broad.md" /%}\n');
      expect(watched.filter((f) => f.startsWith(broadDir) || f.startsWith(fs.realpathSync.native(broadDir)))).toEqual(
        [],
      );
      expect(watched).not.toContain(path.join(partials, 'broad.md'));
    },
  );

  test('a directory named dir.md is not watched', async () => {
    const watched = await watchedBy('{% partial file="dir.md" /%}\n');
    expect(watched.filter((f) => f.startsWith(path.join(partials, 'dir.md')))).toEqual([]);
  });

  test.skipIf(!linkedPartials)(
    'a missing partial in a linked partials directory is watched at both paths',
    async () => {
      const watched = await watchedBy('{% partial file="new.md" /%}\n', linkedRoot);
      expect(watched).toContain(path.join(linkedRoot, 'markdoc/partials/new.md'));
      expect(watched).toContain(path.join(fs.realpathSync.native(sharedPartials), 'new.md'));
    },
  );
});
