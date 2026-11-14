/** 実ファイルシステムを参照するページ判定と、それを使うコンポーネントモジュールの組み立て。 */

import {emitComponentModule} from './codegen/component-module';
import {type ModuleKind, moduleKindOf} from './codegen/shared';
import {realpathOrSelf} from './fs-utils';
import {resolveProjectRoot} from './options';
import {detectPageContext, detectPageContextInDirs, type PageContext, routerDirs} from './page-context';
import type {MarkdocVitePluginOptions} from './types';

/**
 * detectPageContext の結果に出力の種類を加えて返す。
 * @param root resolveProjectRoot で解決済みのプロジェクトルート
 */
export function resolvePageContext(
  resourcePath: string,
  root: string,
  options: MarkdocVitePluginOptions,
): PageContext & {kind: ModuleKind} {
  let context = detectPageContext(resourcePath, root, options);
  if (!context.isPage) {
    // resolve.preserveSymlinks: false ではモジュール id が実パスになるため、シンボリックリンク経由のルートや
    // router ディレクトリは実パスでも判定する。
    const dirs = routerDirs(root, options);
    const realDirs = {app: dirs.app.map(realpathOrSelf), pages: dirs.pages.map(realpathOrSelf)};
    context = detectPageContextInDirs(resourcePath, realDirs, options);
  }
  return {...context, kind: moduleKindOf(context.isPage, context.appMode)};
}

/**
 * `fastRefresh: true` 用の `<file>?markdoc-component` モジュール。
 * @param root Vite の `config.root`。`options.dir` があればそちらを使う。
 */
export function fastRefreshComponentModule(
  resourcePath: string,
  root: string,
  options: MarkdocVitePluginOptions,
): {code: string; map: {mappings: ''}} {
  const {kind} = resolvePageContext(resourcePath, resolveProjectRoot(options, root), options);
  // このモジュールは Markdown を含まない。.md に対応付けると Rollup が .map に元ファイルを埋め込む。
  return {code: emitComponentModule({kind, resourcePath}), map: {mappings: ''}};
}
