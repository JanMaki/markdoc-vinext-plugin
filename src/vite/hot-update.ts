/** hotUpdate フック。 */

import path from 'node:path';
import type {Plugin} from 'vite';
import {type HmrModuleNode, invalidateMarkdocModules, type ModuleGraphLike} from './module-graph';
import {isSchemaFile} from './schema-dir';
import type {PluginState} from './state';

/**
 * `modules` に、import 元を辿って見つかった Markdoc ファイルの全モジュールを加える。
 * partial / スキーマとその依存ファイルの編集ではページモジュールだけが更新され、コンポーネントモジュールは
 * 古いページモジュールを参照し続けるため。
 * スキーマの依存ファイルは compile: 'runtime' では把握できないため、編集されたファイルごとに import 元を辿る。
 */
function collectFastRefreshModules(
  graph: ModuleGraphLike,
  modules: readonly unknown[],
  markdocFiles: ReadonlySet<string>,
): Set<unknown> {
  const updated = new Set<unknown>(modules);
  const seen = new Set<HmrModuleNode>();
  const walk = (mod: HmrModuleNode & {isSelfAccepting?: boolean}): void => {
    if (seen.has(mod)) return;
    seen.add(mod);
    if (mod.file && markdocFiles.has(mod.file)) {
      for (const markdocModule of graph.getModulesByFile(mod.file) ?? []) updated.add(markdocModule);
      return;
    }
    // 更新は self-accepting のモジュールで止まり、その import 元には伝播しない。
    if (mod.isSelfAccepting) return;
    for (const importer of mod.importers) walk(importer);
  };
  for (const mod of modules) walk(mod as HmrModuleNode);
  return updated;
}

/**
 * ページ / partial / スキーマモジュールの編集は Vite の通常の伝播に任せる。
 * 解決結果が変わるスキーマのファイル (isSchemaFile) の追加・削除のみフルリロードする。
 */
export function createHotUpdateHook(state: PluginState): NonNullable<Plugin['hotUpdate']> {
  return function hotUpdate({type, file, modules}) {
    const graph = (): ModuleGraphLike => this.environment.moduleGraph as unknown as ModuleGraphLike;
    if (type === 'update') {
      if (!state.options.fastRefresh) return;
      const updated = collectFastRefreshModules(graph(), modules, state.markdocFiles);
      return updated.size === modules.length ? undefined : ([...updated] as typeof modules);
    }
    if (!isSchemaFile(state, path.resolve(file))) return;
    const moduleGraph = graph();
    invalidateMarkdocModules(moduleGraph, state.markdocFiles);
    // 既定の更新処理を止めるため、`modules` (解決に失敗したモジュール等) もここで無効化する。
    for (const mod of modules) moduleGraph.invalidateModule(mod as never);
    this.environment.hot.send({type: 'full-reload'});
    // 空配列で Vite の既定の更新処理を止める。
    return [];
  };
}
