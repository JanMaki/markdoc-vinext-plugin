/** Vite のモジュールグラフの型と取得、無効化。 */

import type {ViteDevServer} from 'vite';

export type ModuleGraphLike = {
  getModulesByFile(file: string): Set<unknown> | undefined;
  invalidateModule(mod: never): void;
};

/** dev サーバの全 environment のモジュールグラフ。 */
export function moduleGraphsOf(server: ViteDevServer): ModuleGraphLike[] {
  return Object.values(server.environments).map((env) => env.moduleGraph as unknown as ModuleGraphLike);
}

export type HmrModuleNode = {file: string | null; importers: Set<HmrModuleNode>};

/** `files` (`/` 区切りの絶対パス) の全モジュールを無効化する。 */
export function invalidateMarkdocModules(graph: ModuleGraphLike, files: Iterable<string>): void {
  for (const file of files) {
    for (const mod of graph.getModulesByFile(file) ?? []) {
      graph.invalidateModule(mod as never);
    }
  }
}
