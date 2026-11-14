/** frontmatter の読み込みと検証。 */

import type {load as YamlLoad} from 'js-yaml';
import {sanitizeFrontmatter} from './runtime/runtime.js';

/**
 * frontmatter の YAML を読み込み、`$$mdtype` を除いた値を返す。オブジェクト以外（スカラー、null、`~`）は `{}`。配列はそのまま返す。
 * YAML のエラーはモジュール評価時ではなく変換時に、ファイル名付きで出す。
 * @param raw `ast.attributes.frontmatter`
 * @param file エラー文に含めるファイルのパス
 */
export function loadFrontmatter(raw: unknown, yamlLoad: typeof YamlLoad, file: string): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const loaded = yamlLoad(raw);
    const sanitized = sanitizeFrontmatter(loaded);
    // 自己参照するアンカーやエイリアスの過剰な展開は sanitizeFrontmatter / JSON.stringify で失敗するため、ここで検出する。
    JSON.stringify(sanitized);
    return loaded && typeof loaded === 'object' ? (sanitized as Record<string, unknown>) : {};
  } catch (error) {
    throw new Error(
      `[markdoc-vinext] Invalid YAML frontmatter in ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
