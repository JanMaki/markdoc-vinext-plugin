/** 生成モジュールのソースマップ。 */

import path from 'node:path';
import type {SourceMapV3} from '../types';

/**
 * 生成モジュールから Markdown ファイルへのソースマップ。
 * 生成コードの全行を Markdown ファイルの 1 行目 0 列目に対応付ける。
 */
export function markdownSourceMap(code: string, resourcePath: string, source: string): SourceMapV3 {
  return {
    version: 3,
    file: path.basename(resourcePath),
    sources: [resourcePath],
    sourcesContent: [source],
    names: [],
    mappings: code
      .split('\n')
      .map(() => 'AAAA')
      .join(';'),
  };
}
