/** スキーマフォルダの包含判定。 */

import path from 'node:path';
import {SCHEMA_ENTRIES} from '../codegen/names';
import {realpathOrSelf} from '../fs-utils';
import {getSchemaDir} from '../options';
import {isInside} from '../paths';
import {schemaEntryCandidates} from '../schema/resolve';
import type {PluginState} from './state';

/** スキーマフォルダからの、各エントリの候補パスの相対パス。 */
const ENTRY_CANDIDATES = new Set(SCHEMA_ENTRIES.flatMap((entry) => schemaEntryCandidates('', entry)));
const ENTRY_CANDIDATES_LOWER = new Set([...ENTRY_CANDIDATES].map((rel) => rel.toLowerCase()));

/** スキーマフォルダとその下位フォルダの実パス。state.realSchemaDirs にキャッシュする。 */
function cachedRealpath(state: PluginState, dir: string): string {
  let realDir = state.realSchemaDirs.get(dir);
  if (realDir === undefined) {
    realDir = realpathOrSelf(dir);
    state.realSchemaDirs.set(dir, realDir);
  }
  return realDir;
}

/** `file` がスキーマフォルダ (`sub` 指定時はその下位フォルダ) の中か。シンボリックリンク経由のフォルダは実パスでも判定する。 */
export function isInSchemaDir(state: PluginState, file: string, sub = ''): boolean {
  const dir = path.join(getSchemaDir(state.root, state.options), sub);
  if (isInside(dir, file)) return true;
  const realDir = cachedRealpath(state, dir);
  return realDir !== dir && isInside(realDir, file);
}

/**
 * `file` の追加・削除・変更でスキーマの解決結果や partial が変わりうるか。
 * state.narrowSchemaWatch では partials フォルダの中と各エントリの候補パスのみ、それ以外ではスキーマフォルダ全体。
 */
export function isSchemaFile(state: PluginState, file: string): boolean {
  if (!state.narrowSchemaWatch) return isInSchemaDir(state, file);
  if (isInSchemaDir(state, file, 'partials')) return true;
  const dir = getSchemaDir(state.root, state.options);
  const realDir = cachedRealpath(state, dir);
  return isEntryCandidate(path.relative(dir, file)) || isEntryCandidate(path.relative(realDir, file));
}

/** 大文字小文字を区別しないファイルシステムが既定のプラットフォーム。 */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** スキーマフォルダからの相対パスがエントリの候補パスか。 */
function isEntryCandidate(rel: string): boolean {
  return CASE_INSENSITIVE ? ENTRY_CANDIDATES_LOWER.has(rel.toLowerCase()) : ENTRY_CANDIDATES.has(rel);
}
