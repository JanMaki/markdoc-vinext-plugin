/** ページ判定と router 形式の判定。 */

import path from 'node:path';
import {isInside, type PathImpl} from './paths';
import type {MarkdocVitePluginOptions} from './types';

export type PageContext = {isPage: boolean; appMode: boolean; filepath: string | undefined};

function resolveMaybeRelative(root: string, maybe: string | undefined, p: PathImpl): string | undefined {
  if (!maybe) return undefined;
  return p.isAbsolute(maybe) ? p.resolve(maybe) : p.resolve(root, maybe);
}

function routerDirCandidates(root: string, explicit: string | undefined, name: 'app' | 'pages', p: PathImpl): string[] {
  const resolved = resolveMaybeRelative(root, explicit, p);
  if (resolved) return [resolved];
  return [p.join(root, name), p.join(root, 'src', name)];
}

function deepestContainingDir(file: string, dirs: string[], p: PathImpl): string | undefined {
  let best: string | undefined;
  for (const dir of dirs) {
    if (isInside(dir, file, p) && (!best || dir.length > best.length)) best = dir;
  }
  return best;
}

/** router ディレクトリの候補。`appDir` / `pagesDir` の指定値、なければ `<root>/{,src/}{app,pages}`。 */
export type RouterDirs = {app: string[]; pages: string[]};

/** `root` を基準にした router ディレクトリの候補。 */
export function routerDirs(root: string, options: MarkdocVitePluginOptions, p: PathImpl = path): RouterDirs {
  const absRoot = p.resolve(root);
  return {
    app: routerDirCandidates(absRoot, options.appDir, 'app', p),
    pages: routerDirCandidates(absRoot, options.pagesDir, 'pages', p),
  };
}

/**
 * Markdoc ファイルがページかどうか、出力する router 形式、router 相対パス (`file.path`) を判定する。
 *
 * 判定には `appDir` / `pagesDir` (指定値、または `<root>/{,src/}{app,pages}`) のみを使い、
 * 絶対パス中の任意の `app/` / `pages/` は見ない。Docker の `WORKDIR /app` や `pages` という名前の
 * リポジトリでも全ファイルがページになることはない。
 *
 * シンボリックリンク経由の router ディレクトリの実パスでの判定は page-detection.ts の resolvePageContext が行う。
 *
 * @param p 判定に使うパスの実装。`path.win32` を渡すと Windows のパスを判定できる。
 */
export function detectPageContext(
  resourcePath: string,
  root: string,
  options: MarkdocVitePluginOptions,
  p: PathImpl = path,
): PageContext {
  return detectPageContextInDirs(resourcePath, routerDirs(root, options, p), options, p);
}

/** routerDirs の候補を使って detectPageContext と同じ判定をする。 */
export function detectPageContextInDirs(
  resourcePath: string,
  dirs: RouterDirs,
  options: MarkdocVitePluginOptions,
  p: PathImpl = path,
): PageContext {
  const file = p.resolve(resourcePath);
  const appDir = deepestContainingDir(file, dirs.app, p);
  const pagesDir = deepestContainingDir(file, dirs.pages, p);

  let kind: 'app' | 'pages' | null = null;
  let base: string | undefined;
  if (appDir && pagesDir) {
    // router ディレクトリが入れ子の場合、深い方を優先する。
    kind = appDir.length >= pagesDir.length ? 'app' : 'pages';
    base = kind === 'app' ? appDir : pagesDir;
  } else if (appDir) {
    kind = 'app';
    base = appDir;
  } else if (pagesDir) {
    kind = 'pages';
    base = pagesDir;
  }

  if (!kind || !base) {
    return {isPage: false, appMode: false, filepath: undefined};
  }

  const router = options.router ?? 'auto';
  const appMode = router === 'app' ? true : router === 'pages' ? false : kind === 'app';
  const rel = p.relative(base, file).split(p.sep).join('/');
  return {isPage: true, appMode, filepath: `/${rel}`};
}
