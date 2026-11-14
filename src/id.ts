/** モジュール id のクエリと拡張子の判定。 */

import {DEFAULT_EXTENSIONS} from './options';
import type {MarkdocVitePluginOptions} from './types';

/**
 * Markdoc モジュールとして扱わない id のクエリパラメータ。
 * それ以外のクエリ (`?t=`、`?v=`、フレームワーク固有のマーカー等) は除去して通常どおり変換する。
 */
const SKIP_QUERY_PARAMS = new Set([
  'raw',
  'url',
  'inline',
  'no-inline',
  'worker',
  'sharedworker',
  'worker_file',
  'direct',
  'html-proxy',
  'commonjs-proxy',
  'commonjs-entry',
  'commonjs-external',
  'commonjs-exports',
  'commonjs-module',
  'commonjs-wrapped',
  'commonjs-es-import',
]);

/** id をファイル部分と `?` 以降のクエリ (`#` 以降を除く) に分ける。 */
export function splitQuery(id: string): {file: string; query: string} {
  const queryIndex = id.indexOf('?');
  const hashIndex = id.indexOf('#');
  let end = id.length;
  if (queryIndex >= 0) end = Math.min(end, queryIndex);
  if (hashIndex >= 0) end = Math.min(end, hashIndex);
  const query = queryIndex >= 0 ? id.slice(queryIndex + 1, hashIndex > queryIndex ? hashIndex : undefined) : '';
  return {file: id.slice(0, end), query};
}

/** id からクエリとハッシュを除いたファイル部分。 */
export function stripQueryAndHash(id: string): string {
  return splitQuery(id).file;
}

/** 拡張子を `.` 始まりの小文字にする。 */
function normalizeExtension(ext: string): string {
  return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

/** `filePath` が `extensions` のいずれかで終わるか。大文字小文字を区別しない。 */
export function hasExtension(filePath: string, extensions: string[]): boolean {
  const lower = filePath.toLowerCase();
  return extensions.map(normalizeExtension).some((ext) => lower.endsWith(ext));
}

/** `extension` (RegExp) があればそれで、なければ `extensions` で変換対象のファイルか判定する。 */
function matchesExtension(filePath: string, options: MarkdocVitePluginOptions): boolean {
  if (options.extension instanceof RegExp) {
    // /g・/y 付きの正規表現で結果が交互に変わらないようリセットする。
    options.extension.lastIndex = 0;
    const result = options.extension.test(filePath);
    options.extension.lastIndex = 0;
    return result;
  }
  return hasExtension(filePath, options.extensions ?? DEFAULT_EXTENSIONS);
}

/** Markdoc モジュールとして変換する id か。`\0` 付きの仮想 id、node_modules、SKIP_QUERY_PARAMS のクエリ付きは除く。 */
export function shouldTransformId(id: string, options: MarkdocVitePluginOptions = {}): boolean {
  if (!id || id.startsWith('\0')) return false;
  const {file, query} = splitQuery(id);
  if (/(?:^|[\\/])node_modules[\\/]/.test(file)) return false;
  if (query) {
    for (const key of new URLSearchParams(query).keys()) {
      if (SKIP_QUERY_PARAMS.has(key)) return false;
    }
  }
  return matchesExtension(file, options);
}

/** `transform` のフックフィルタ (Vite ≥ 6.3)。handler でも shouldTransformId で再確認する。 */
export function transformIdFilter(options: MarkdocVitePluginOptions): RegExp[] {
  if (options.extension instanceof RegExp) {
    // `$` で終わる正規表現は `?import` / `?t=` 付きの id に一致しないため、クエリ付きの id も handler に渡す。
    return [new RegExp(options.extension.source, options.extension.flags.replace(/[gy]/g, '')), /[?#]/];
  }
  const exts = (options.extensions ?? DEFAULT_EXTENSIONS).map((e) =>
    normalizeExtension(e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  return [new RegExp(`(?:${exts.join('|')})(?:[?#]|$)`, 'i')];
}
