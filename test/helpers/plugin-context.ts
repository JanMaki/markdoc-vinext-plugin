import fs from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';

/** `{filter, handler}` 形式のフック。 */
export type HookWithFilter = {filter?: {id?: unknown}; handler: unknown};

/** フックの `filter.id` を取り出す。 */
export function filterIdOf(hook: unknown): unknown {
  return (hook as {filter: {id: unknown}}).filter.id;
}

type ResolveResult = {id: string; external: boolean} | null;

/** プラグインのフックを Vite なしで呼ぶための最小限のコンテキスト。 */
export type FakePluginContext = {
  environment: {config: {consumer: 'client' | 'server'}};
  meta: {watchMode: boolean};
  resolve: (request: string, importer: string) => Promise<ResolveResult>;
  addWatchFile: (file: string) => void;
};

/**
 * 既定の `resolve` は importer と同じディレクトリの `<request>.ts` が存在すればそれを返す。
 * `onResolve` は resolve の呼び出しごと、`watched` は addWatchFile の引数を記録する。
 */
export function fakePluginContext(
  options: {
    watchMode?: boolean;
    onResolve?: () => void;
    watched?: string[];
    resolve?: (request: string, importer: string) => Promise<ResolveResult>;
  } = {},
): FakePluginContext {
  return {
    environment: {config: {consumer: 'client'}},
    meta: {watchMode: options.watchMode ?? false},
    async resolve(request, importer) {
      options.onResolve?.();
      if (options.resolve) return options.resolve(request, importer);
      const file = path.resolve(path.dirname(importer), `${request}.ts`);
      return fs.existsSync(file) ? {id: file, external: false} : null;
    },
    addWatchFile(file) {
      options.watched?.push(file);
    },
  };
}

/** `configResolved` を偽の ResolvedConfig で呼ぶ。警告は `warns` に記録する。 */
export function callConfigResolved(
  plugin: Plugin,
  config: {root: string; command: 'serve' | 'build'; define?: Record<string, string>; warns?: string[]},
): void {
  const hook = plugin.configResolved as (this: unknown, c: unknown) => void;
  hook.call(
    {},
    {
      root: config.root,
      command: config.command,
      resolve: {alias: []},
      define: config.define,
      logger: {warn: (msg: string) => config.warns?.push(msg), info: () => undefined},
    },
  );
}

/** `transform` の handler を偽コンテキストで呼ぶ。 */
export async function callTransform(
  plugin: Plugin,
  ctx: FakePluginContext,
  code: string,
  id: string,
): Promise<{code: string} | null> {
  const handler = (plugin.transform as {handler: (this: unknown, ...a: unknown[]) => unknown}).handler;
  return (await handler.call(ctx, code, id, {})) as {code: string} | null;
}

/** `watchChange` を update イベントで呼ぶ。 */
export function callWatchChange(plugin: Plugin, id: string): void {
  (plugin.watchChange as (this: unknown, id: string, change: {event: string}) => void).call({}, id, {
    event: 'update',
  });
}
