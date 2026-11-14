/** configureServer (watcher) / watchChange フック。 */

import fs from 'node:fs';
import path from 'node:path';
import {normalizePath, type Plugin, type ViteDevServer} from 'vite';
import {clearMarkdocCache, clearPartialCache} from '../cache';
import {realpathOfNearestExisting} from '../fs-utils';
import {stripQueryAndHash} from '../id';
import {getSchemaDir} from '../options';
import {broadPartialsWarning, findBroadPartialsDir} from '../partials-watch';
import {invalidateMarkdocModules, moduleGraphsOf} from './module-graph';
import {isInSchemaDir, isSchemaFile} from './schema-dir';
import type {PluginState} from './state';

/** スキーマのファイルの追加・削除をまとめて処理する間隔 (ms)。 */
export const SCHEMA_EVENT_DEBOUNCE_MS = 30;

/**
 * スキーマのファイル (isSchemaFile) の追加・削除を SCHEMA_EVENT_DEBOUNCE_MS の間まとめて処理するハンドラを作る。
 * `isDir` はディレクトリのイベント。`dispose` は保留中の処理を取り消す。
 */
function createSchemaDirEventHandler(
  state: PluginState,
  server: ViteDevServer,
): {onEvent: (isDir: boolean) => (file: string) => void; dispose: () => void} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reload = false;
  const flush = (): void => {
    timer = undefined;
    // `server.hmr: false` では hotUpdate が呼ばれないため、ここでも無効化する。
    for (const graph of moduleGraphsOf(server)) invalidateMarkdocModules(graph, state.markdocFiles);
    // ディレクトリのイベントは hotUpdate に届かないため、ここで environment ごとにリロードする。
    if (reload) {
      for (const env of Object.values(server.environments ?? {})) env.hot.send({type: 'full-reload'});
    }
    reload = false;
  };
  const onEvent = (isDir: boolean) => (file: string) => {
    if (!isSchemaFile(state, path.resolve(file))) return;
    clearMarkdocCache(state.cache);
    // シンボリックリンクの partials フォルダ等の追加・削除で実パスが変わる。
    if (isDir) state.realSchemaDirs.clear();
    reload ||= isDir;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SCHEMA_EVENT_DEBOUNCE_MS);
  };
  return {onEvent, dispose: () => clearTimeout(timer)};
}

/**
 * Vite はルートを監視済み。ルート外のスキーマフォルダを監視対象に加える。chokidar は存在しないパスも受け付ける。
 * state.narrowSchemaWatch では、存在する partials フォルダのみ加える。実パスが広すぎる partials フォルダは警告して監視しない。chokidar 3 は存在しないファイルの作成を通知しない。
 * 既存のエントリは transform の addWatchFile で監視する。
 */
function watchSchemaDir(state: PluginState, server: ViteDevServer): void {
  const schemaDir = getSchemaDir(state.root, state.options);
  const partialsDir = path.join(schemaDir, 'partials');
  const broad = findBroadPartialsDir(schemaDir, state.root);
  if (broad) server.config.logger.warn(broadPartialsWarning(partialsDir, broad));
  if (!state.narrowSchemaWatch) {
    server.watcher.add(schemaDir);
    // chokidar はリンク先を再帰的に監視するため、add の後に外す。
    if (broad) server.watcher.unwatch(partialsDir);
    return;
  }
  if (!broad && fs.existsSync(partialsDir)) server.watcher.add(partialsDir);
}

/** server.close 時に state.devServers から外し、保留中の処理を取り消す。httpServer のないミドルウェアモードでも動くよう close を包む。 */
function releaseOnClose(state: PluginState, server: ViteDevServer, dispose: () => void): void {
  const close = server.close.bind(server);
  server.close = () => {
    dispose();
    state.devServers.delete(server);
    return close();
  };
}

/** スキーマフォルダを監視し、スキーマのファイルの追加・削除でキャッシュを消去してモジュールを無効化する。 */
export function createConfigureServerHook(state: PluginState): NonNullable<Plugin['configureServer']> {
  return (server) => {
    // 再起動に失敗した場合は前のサーバが動き続けるため、すべての dev サーバを保持する。
    state.devServers.add(server);
    watchSchemaDir(state, server);
    // スキーマフォルダ内のファイルの追加・削除で `config`/`tags`/`nodes`/`functions` の解決結果や
    // partial の有無が変わる。既存ファイルの変更は addWatchFile で追跡する。
    const {onEvent, dispose} = createSchemaDirEventHandler(state, server);
    releaseOnClose(state, server, dispose);
    server.watcher.on('unlink', (file) => {
      const abs = path.resolve(file);
      state.markdocFiles.delete(normalizePath(abs));
      // シンボリックリンク経由の Markdoc ファイルは実パスで登録されるため、実パスのキーも削除する。
      state.markdocFiles.delete(normalizePath(realpathOfNearestExisting(abs)));
    });
    server.watcher.on('add', onEvent(false));
    server.watcher.on('unlink', onEvent(false));
    server.watcher.on('addDir', onEvent(true));
    server.watcher.on('unlinkDir', onEvent(true));
  };
}

/** dev と build --watch で再変換の前に呼ばれる。次の変換で最新のファイルを読むようキャッシュを消去する。 */
export function createWatchChangeHook(state: PluginState): NonNullable<Plugin['watchChange']> {
  return (id) => {
    const file = path.resolve(stripQueryAndHash(id));
    const partial = isInSchemaDir(state, file, 'partials');
    if (state.cache.deps.has(file) || (!partial && isSchemaFile(state, file))) {
      clearMarkdocCache(state.cache);
      // compile: 'build' のページはスキーマを変換時に評価する。Vite は import 元を transform し直さない
      // soft invalidation で済ませるため、Markdoc のモジュールを無効化して再変換させる。
      if (state.options.compile !== 'build') return;
      for (const server of state.devServers) {
        for (const graph of moduleGraphsOf(server)) invalidateMarkdocModules(graph, state.markdocFiles);
      }
    } else if (partial) {
      clearPartialCache(state.cache);
    }
  };
}
