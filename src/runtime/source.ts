/** 仮想 runtime モジュールのソース。 */

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * `virtual:markdoc-vinext/runtime` として load フックが返すソース。
 * 文字列として読み込むため、プロジェクトルート外 (`server.fs.allow` の対象外) へのインストール時や
 * `file://` を解決できない Vite でも動く。
 */
export const INLINE_RUNTIME_SOURCE = readFileSync(fileURLToPath(new URL('./runtime.js', import.meta.url)), 'utf8');
