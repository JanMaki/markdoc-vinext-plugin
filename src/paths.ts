/** パスの包含判定と import 指定子。 */

import path from 'node:path';

/** パスの実装。純関数は既定で `node:path` を使い、`path.win32` を渡すと Windows のパスを扱う。 */
export type PathImpl = typeof path.posix;

/** `file` が `dir` 自身またはその配下なら true。Windows のドライブレターの大文字小文字は `path.relative` で吸収する。 */
export function isInside(dir: string, file: string, p: PathImpl = path): boolean {
  const rel = p.relative(dir, file);
  if (rel === '') return true;
  if (p.isAbsolute(rel)) return false; // Windows で別ドライブ
  return rel !== '..' && !rel.startsWith(`..${p.sep}`);
}

/**
 * 生成モジュール (`from`) から `to` への import 指定子。
 * `p` に `path.win32` を渡すと Windows のパスとして扱う。
 * @markdoc/next.js の src/loader.js を元にしている (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
 */
export function getRelativeImportPath(from: string, to: string, p: PathImpl = path): string {
  const relative = p.relative(p.dirname(from), to);
  if (!relative) {
    return './';
  }
  if (p.isAbsolute(relative)) {
    // Windows で別ドライブの場合、`path.relative` は絶対パスを返す。
    // Vite はスラッシュ区切りの絶対パスを受け付ける。
    return relative.split(p.sep).join('/');
  }
  const request = relative.split(p.sep).join('/');
  return request.startsWith('../') || request.startsWith('./') ? request : `./${request}`;
}

/** ファイルシステムのルートやホームディレクトリを含むディレクトリ。`server.fs.allow` に自動で追加しない。 */
export function isTooBroadToAllow(dir: string, home: string): boolean {
  return path.parse(dir).root === dir || isInside(dir, home);
}
