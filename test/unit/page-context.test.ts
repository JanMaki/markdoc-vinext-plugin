import {describe, expect, test} from 'bun:test';
import path from 'node:path';
import {detectPageContext} from '../../src/page-context';
import {resolvePageContext} from '../../src/page-detection';
import {trySymlink, writeFile} from '../helpers/fixtures';
import {appSample, componentSample, exampleRoot, pagesSample, tmpDirFor} from '../helpers/paths';

const dir = tmpDirFor(import.meta);
const NOT_A_PAGE = {isPage: false, appMode: false, filepath: undefined};
const app = (filepath: string) => ({isPage: true, appMode: true, filepath});
const pages = (filepath: string) => ({isPage: true, appMode: false, filepath});

describe('detectPageContext: samples', () => {
  for (const [label, file, router, expected] of [
    ['pages sample, auto', pagesSample, 'auto', pages('/docs/getting-started.md')],
    ['app sample, auto', appSample, 'auto', app('/docs/page.md')],
    ['component sample, auto', componentSample, 'auto', NOT_A_PAGE],
    ['component sample, router: pages', componentSample, 'pages', NOT_A_PAGE],
    ['component sample, router: app', componentSample, 'app', NOT_A_PAGE],
    ['pages sample, router: app → App shape', pagesSample, 'app', app('/docs/getting-started.md')],
    ['app sample, router: pages → Pages shape', appSample, 'pages', pages('/docs/page.md')],
  ] as const) {
    test(label, () => {
      expect(detectPageContext(file, exampleRoot, {router})).toEqual(expected);
    });
  }
});

describe('detectPageContext: router directories', () => {
  for (const [label, file, root, options, expected] of [
    ['Docker WORKDIR /app: components/note.md is not a page', '/app/components/note.md', '/app', {}, NOT_A_PAGE],
    ['Docker WORKDIR /app: app/docs/page.md is an App page', '/app/app/docs/page.md', '/app', {}, app('/docs/page.md')],
    [
      'filepath ignores app/ segments above the root',
      '/srv/app/proj/app/docs/page.md',
      '/srv/app/proj',
      {},
      app('/docs/page.md'),
    ],
    ['content/pages/guide.md is not a page', '/p/content/pages/guide.md', '/p', {}, NOT_A_PAGE],
    [
      'repo named "pages": docs/x.md is not a page',
      '/home/runner/work/pages/pages/docs/x.md',
      '/home/runner/work/pages/pages',
      {},
      NOT_A_PAGE,
    ],
    ['src/app is detected', '/p/src/app/a/page.md', '/p', {}, app('/a/page.md')],
    ['src/pages is detected', '/p/src/pages/a.md', '/p', {}, pages('/a.md')],
    ['outside the root is not a page', '/other/app/x.md', '/p', {}, NOT_A_PAGE],
    ['explicit appDir replaces the default app/', '/p/app/x.md', '/p', {appDir: 'site/app'}, NOT_A_PAGE],
    ['explicit appDir is detected', '/p/site/app/x.md', '/p', {appDir: 'site/app'}, app('/x.md')],
    ['absolute appDir is used as is', '/abs/app/x.md', '/p', {appDir: '/abs/app'}, app('/x.md')],
    [
      'pagesDir nested in appDir: the deeper pagesDir wins',
      '/p/site/pages/x.md',
      '/p',
      {appDir: 'site', pagesDir: 'site/pages'},
      pages('/x.md'),
    ],
    [
      'appDir nested in pagesDir: the deeper appDir wins',
      '/p/site/app/x.md',
      '/p',
      {appDir: 'site/app', pagesDir: 'site'},
      app('/x.md'),
    ],
    [
      'nested router dirs: a file only in the outer dir uses the outer dir',
      '/p/site/x.md',
      '/p',
      {appDir: 'site', pagesDir: 'site/pages'},
      app('/x.md'),
    ],
  ] as const) {
    test(label, () => {
      expect(detectPageContext(file, root, options, path.posix)).toEqual(expected);
    });
  }

  test('win32: drive-letter case does not break detection', () => {
    expect(detectPageContext('C:\\proj\\app\\docs\\page.md', 'c:\\proj', {}, path.win32)).toEqual(app('/docs/page.md'));
  });

  test('win32: another drive is not a page', () => {
    expect(detectPageContext('D:\\proj\\app\\page.md', 'C:\\proj', {}, path.win32)).toEqual(NOT_A_PAGE);
  });
});

describe('resolvePageContext: linked root', () => {
  const realRoot = path.join(dir, 'real');
  const linkRoot = path.join(dir, 'link');
  // skipIf の判定に使うため、収集時に作成する。
  writeFile(path.join(realRoot, 'app/page.md'), '# x\n');
  const linked = trySymlink(realRoot, linkRoot, 'junction');

  // resolve.preserveSymlinks: false では id が実パスになり、root はリンクのままになる。
  test.skipIf(!linked)('a real-path id under a linked root is detected through the real root', () => {
    expect(resolvePageContext(path.join(realRoot, 'app/page.md'), linkRoot, {})).toEqual({
      ...app('/page.md'),
      kind: 'app-page',
    });
  });

  test.skipIf(!linked)('a link-path id under the linked root is detected directly', () => {
    expect(resolvePageContext(path.join(linkRoot, 'app/page.md'), linkRoot, {})).toEqual({
      ...app('/page.md'),
      kind: 'app-page',
    });
  });

  test.skipIf(!linked)('an explicit absolute appDir through the linked root is detected through its real path', () => {
    expect(
      resolvePageContext(path.join(realRoot, 'app/page.md'), linkRoot, {appDir: path.join(linkRoot, 'app')}),
    ).toEqual({...app('/page.md'), kind: 'app-page'});
  });

  test('a non-page under an unlinked root stays a component', () => {
    expect(resolvePageContext(path.join(realRoot, 'note.md'), realRoot, {})).toEqual({
      ...NOT_A_PAGE,
      kind: 'component',
    });
  });
});

describe('resolvePageContext: linked router dir', () => {
  const root = path.join(dir, 'plain-root');
  const realPages = path.join(dir, 'elsewhere/pages');
  writeFile(path.join(realPages, 'docs/a.md'), '# x\n');
  writeFile(path.join(root, 'package.json'), '{}\n');
  // skipIf の判定に使うため、収集時に作成する。
  const linked = trySymlink(realPages, path.join(root, 'pages'), 'junction');

  test.skipIf(!linked)('a real-path id under a linked `<root>/pages` is a page', () => {
    expect(resolvePageContext(path.join(realPages, 'docs/a.md'), root, {})).toEqual({
      ...pages('/docs/a.md'),
      kind: 'pages-page',
    });
  });
});

describe('resolvePageContext: linked src router dirs and explicit relative pagesDir', () => {
  const root = path.join(dir, 'src-root');
  const realApp = path.join(dir, 'elsewhere/src-app');
  const realContent = path.join(dir, 'elsewhere/content-pages');
  writeFile(path.join(realApp, 'docs/page.md'), '# x\n');
  writeFile(path.join(realContent, 'b.md'), '# x\n');
  writeFile(path.join(root, 'src/.keep'), '');
  writeFile(path.join(root, 'content/.keep'), '');
  // skipIf の判定に使うため、収集時に作成する。
  const linkedApp = trySymlink(realApp, path.join(root, 'src/app'), 'junction');
  const linkedContent = trySymlink(realContent, path.join(root, 'content/pages'), 'junction');

  test.skipIf(!linkedApp)('a real-path id under a linked `<root>/src/app` is an app page', () => {
    expect(resolvePageContext(path.join(realApp, 'docs/page.md'), root, {})).toEqual({
      ...app('/docs/page.md'),
      kind: 'app-page',
    });
  });

  test.skipIf(!linkedContent)('a real-path id under a linked relative pagesDir is a pages page', () => {
    expect(resolvePageContext(path.join(realContent, 'b.md'), root, {pagesDir: 'content/pages'})).toEqual({
      ...pages('/b.md'),
      kind: 'pages-page',
    });
  });

  test.skipIf(!linkedContent)('the same id without pagesDir stays a component', () => {
    expect(resolvePageContext(path.join(realContent, 'b.md'), root, {})).toEqual({...NOT_A_PAGE, kind: 'component'});
  });
});
