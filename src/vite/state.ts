/** プラグインのインスタンスごとの状態。 */

import type {Alias, UserConfig, ViteDevServer} from 'vite';
import {createMarkdocCache} from '../cache';
import {resolveProjectRoot} from '../options';
import type {MarkdocCache, MarkdocVitePluginOptions} from '../types';

export type PluginState = {
  options: MarkdocVitePluginOptions;
  /** プロジェクトのルート。configResolved で確定する。 */
  root: string;
  /** config フックで受け取った、実パスにする前のルート。 */
  configRoot: string | undefined;
  alias: Alias[];
  /** ユーザー設定の `define`。runnerImport はプロジェクトの設定ファイルを読まないため渡す。 */
  define: NonNullable<UserConfig['define']>;
  isBuild: boolean;
  /** configureServer 済みで close されていない dev サーバ。 */
  devServers: Set<ViteDevServer>;
  /** スキーマフォルダがルートやホームディレクトリを含む (shouldNarrowSchemaWatch)。configResolved で確定する。 */
  narrowSchemaWatch: boolean;
  /** 変換済みの全 Markdoc ファイルの絶対パス (add / unlink 時の無効化用)。モジュールグラフのキーに合わせ `/` 区切りにする。 */
  markdocFiles: Set<string>;
  /** isInSchemaDir 用のスキーマフォルダ (と下位フォルダ) → 実パス。configResolved とスキーマフォルダ内のディレクトリの追加・削除で消去する。 */
  realSchemaDirs: Map<string, string>;
  cache: MarkdocCache;
};

/** 初期状態。`root` は configResolved までは `dir` または `process.cwd()`。 */
export function createPluginState(options: MarkdocVitePluginOptions): PluginState {
  return {
    options,
    root: resolveProjectRoot(options, process.cwd()),
    configRoot: undefined,
    alias: [],
    define: {},
    isBuild: false,
    devServers: new Set(),
    narrowSchemaWatch: false,
    markdocFiles: new Set(),
    realSchemaDirs: new Map(),
    cache: createMarkdocCache(),
  };
}
