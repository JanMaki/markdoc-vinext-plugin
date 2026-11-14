import {EventEmitter} from 'node:events';
import {SCHEMA_EVENT_DEBOUNCE_MS} from '../../src/vite/dev-watch';

/** スキーマフォルダのイベントのデバウンスが確実に終わる時間。 */
export const DEBOUNCE_SETTLED_MS = SCHEMA_EVENT_DEBOUNCE_MS + 20;

/** `pageKey` のモジュールを 1 つ持つモジュールグラフと hot チャネルを記録する偽の environment。 */
export function fakeEnvironment(pageKey: string) {
  const page = {file: pageKey};
  const invalidated: unknown[] = [];
  const sent: unknown[] = [];
  const env = {
    moduleGraph: {
      getModulesByFile: (file: string) => (file === pageKey ? new Set([page]) : undefined),
      invalidateModule: (m: unknown) => invalidated.push(m),
    },
    hot: {send: (payload: unknown) => sent.push(payload)},
  };
  return {env, invalidated, sent};
}

/**
 * 偽の watcher と environment を持つ dev サーバ。`added` は watcher.add の引数、`unwatched` は watcher.unwatch の引数、`counts.closed` は元の close の呼び出し回数、
 * `warned` は config.logger.warn の引数。
 */
export function fakeServer(environments: Record<string, unknown>) {
  const added: string[] = [];
  const unwatched: string[] = [];
  const warned: string[] = [];
  const counts = {closed: 0};
  const watcher = Object.assign(new EventEmitter(), {
    add: (p: string | string[]) => added.push(...[p].flat()),
    unwatch: (p: string | string[]) => unwatched.push(...[p].flat()),
  });
  const server = {
    watcher,
    environments,
    config: {logger: {warn: (message: string) => warned.push(message)}},
    close: async () => {
      counts.closed++;
    },
  };
  return {server, watcher, added, unwatched, warned, counts};
}
