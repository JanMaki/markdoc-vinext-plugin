/** スキーマ解決 / partial / スキーマモジュールの共有キャッシュ。 */

import type {MarkdocCache} from './types';

export function createMarkdocCache(): MarkdocCache {
  return {schemaEntries: new Map(), partials: new Map(), schemaModules: new Map(), deps: new Set(), generation: 0};
}

/** スキーマの解決結果、partial、スキーマモジュールを消去する。スキーマフォルダまたはスキーマの依存ファイルの変更時に呼ぶ。 */
export function clearMarkdocCache(cache: MarkdocCache): void {
  cache.schemaEntries.clear();
  cache.partials.clear();
  cache.schemaModules.clear();
  cache.generation++;
}

/** partial の内容だけを消去する。 */
export function clearPartialCache(cache: MarkdocCache): void {
  cache.partials.clear();
  cache.generation++;
}
