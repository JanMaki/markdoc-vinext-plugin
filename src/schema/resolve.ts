/**
 * スキーマのエントリの解決。
 * 一部は @markdoc/next.js の src/loader.js を元にしている (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
 */

import path from 'node:path';
import {SCHEMA_ENTRIES, type SchemaEntry, type SchemaFiles} from '../codegen/names';
import {isDirectory, isFile} from '../fs-utils';
import {isDefaultSchemaPath} from '../options';
import {findBroadPartialsDir} from '../partials-watch';
import {isInside} from '../paths';
import type {TransformMarkdocContext} from '../types';

const RESOLVE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.json'];

export type {SchemaFiles} from '../codegen/names';

type ResolveSchemaFilesContext = Pick<
  TransformMarkdocContext,
  'cache' | 'root' | 'resolve' | 'watchMissingSchemaEntries' | 'narrowSchemaWatch'
> & {
  schemaPath: string;
  watch: (file: string) => void;
};

/** `request` を `schemaDir` 基準で、そのまま → RESOLVE_EXTENSIONS を付加 → ディレクトリの index の順に探す。 */
async function resolveFromFilesystem(schemaDir: string, request: string): Promise<string | null> {
  const base = path.resolve(schemaDir, request);

  if (await isFile(base)) return base;

  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = base + ext;
    if (await isFile(withExt)) return withExt;
  }

  if (await isDirectory(base)) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const index = path.join(base, `index${ext}`);
      if (await isFile(index)) return index;
    }
  }

  return null;
}

/**
 * `config` / `tags` / `nodes` / `functions` をスキーマフォルダからの相対パスでのみ解決する。
 * 公式ローダーは webpack の `preferRelative: true` を使うが、ここでは bare specifier を試さないため、
 * `node_modules` にある `config` 等と同名のパッケージを読み込まない。
 * `./<entry>` を schemaDir から解決する形は @markdoc/next.js の src/loader.js を元にしている。
 */
async function resolveSchemaEntry(
  schemaDir: string,
  variable: string,
  resolve?: (contextDir: string, request: string) => Promise<string | null>,
): Promise<string | null> {
  const request = `./${variable}`;
  if (resolve) {
    try {
      const resolved = await resolve(schemaDir, request);
      if (resolved && isInside(schemaDir, resolved)) return resolved;
    } catch {
      // ファイルシステム探索に進む
    }
  }
  return resolveFromFilesystem(schemaDir, request);
}

/** キャッシュを使ってエントリを解決する。 */
async function resolveCachedEntry(
  schemaDir: string,
  variable: SchemaEntry,
  ctx: ResolveSchemaFilesContext,
): Promise<string | null> {
  const {cache} = ctx;
  const key = `${schemaDir}\0${variable}`;
  let resolved = cache?.schemaEntries.get(key);
  if (resolved === undefined) {
    const generation = cache?.generation;
    resolved = await resolveSchemaEntry(schemaDir, variable, ctx.resolve);
    // 解決中にキャッシュが消去された場合、古い結果を書き戻さない。
    if (cache && cache.generation === generation) cache.schemaEntries.set(key, resolved);
  }
  return resolved;
}

/** エントリの候補パス。`<entry>` に RESOLVE_EXTENSIONS を付けたファイルと `<entry>/index.*`。 */
export function schemaEntryCandidates(schemaDir: string, variable: SchemaEntry): string[] {
  return RESOLVE_EXTENSIONS.flatMap((ext) => [
    path.join(schemaDir, `${variable}${ext}`),
    path.join(schemaDir, variable, `index${ext}`),
  ]);
}

/** 存在しないエントリの候補パスを監視する。 */
function watchMissingEntry(schemaDir: string, variable: SchemaEntry, ctx: ResolveSchemaFilesContext): void {
  const {watch} = ctx;
  // Rolldown の watcher は存在しないファイルを監視しないため、スキーマフォルダも監視する。
  // partials フォルダの実パスが広すぎる場合は再帰的な監視を避けるため監視しない。
  if (!findBroadPartialsDir(schemaDir, ctx.root)) watch(schemaDir);
  for (const file of schemaEntryCandidates(schemaDir, variable)) watch(file);
}

/**
 * スキーマフォルダの `config` / `tags` / `nodes` / `functions` を順に解決し、解決したファイルを監視する。
 * 指定された schemaPath のフォルダがなければ例外を投げる。既定のパスがなければ空のスキーマとして扱う。
 * フォルダがない場合の扱い、例外の文言、解決失敗時の console.debug は @markdoc/next.js の src/loader.js を元にしている。
 */
export async function resolveSchemaFiles(
  schemaDir: string,
  ctx: ResolveSchemaFilesContext,
): Promise<{exists: boolean; files: SchemaFiles}> {
  const files: SchemaFiles = {};
  if (!(await isDirectory(schemaDir))) {
    if (!isDefaultSchemaPath(ctx.schemaPath)) {
      throw new Error(`Cannot find module '${ctx.schemaPath}' at '${schemaDir}'`);
    }
    return {exists: false, files};
  }
  for (const variable of SCHEMA_ENTRIES) {
    try {
      const resolved = await resolveCachedEntry(schemaDir, variable, ctx);
      if (!resolved) {
        if (ctx.watchMissingSchemaEntries && !ctx.narrowSchemaWatch) watchMissingEntry(schemaDir, variable, ctx);
        continue;
      }
      ctx.watch(resolved);
      files[variable] = resolved;
    } catch (error) {
      console.debug('[markdoc-vinext] Failed to resolve', {schemaDir, variable, error});
    }
  }
  return {exists: true, files};
}
