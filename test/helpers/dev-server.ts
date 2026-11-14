import {createServer, type InlineConfig, type Plugin, type ServerOptions, type ViteDevServer} from 'vite';
import {sleep} from './code';

/**
 * ミドルウェアモードの dev サーバ。ファイル監視の初期スキャン完了 (最大 3 秒) を待ってから返す。
 * @param extra `server` 以外の設定 (`resolve` 等) に重ねる値。`plugins` は `plugin` の後に加える
 */
export async function startDevServer(
  devRoot: string,
  plugin: Plugin,
  server: ServerOptions = {},
  extra: InlineConfig = {},
): Promise<ViteDevServer> {
  const s = await createServer({
    root: devRoot,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: {noDiscovery: true, include: []},
    ...extra,
    server: {middlewareMode: true, ...server},
    plugins: [plugin, ...(extra.plugins ?? [])],
  });
  // chokidar 3 は ready 発火後に `_readyEmitted` を true にする。
  const watcher = s.watcher as typeof s.watcher & {_readyEmitted?: boolean};
  if (!watcher._readyEmitted) {
    await Promise.race([new Promise((r) => watcher.once('ready', r)), sleep(3000)]);
  }
  return s;
}

/** dev サーバを閉じる。close の例外は握りつぶさない。 */
export async function closeServer(server: ViteDevServer | undefined): Promise<void> {
  await server?.close();
}

export type HotPayload = {env: string; payload: {type: string; updates?: {path: string; acceptedPath: string}[]}};

/** 各 environment の hot チャネルに送られた payload を記録する。 */
export function recordHotPayloads(server: ViteDevServer): HotPayload[] {
  const payloads: HotPayload[] = [];
  for (const [name, env] of Object.entries(server.environments)) {
    const original = env.hot.send.bind(env.hot);
    env.hot.send = ((payload: never, ...rest: never[]) => {
      payloads.push({env: name, payload});
      return (original as (...a: unknown[]) => void)(payload, ...rest);
    }) as typeof env.hot.send;
  }
  return payloads;
}

/** client の update payload に含まれるモジュールのパス。 */
export function clientUpdatePaths(payloads: HotPayload[]): string[] {
  return payloads.flatMap((p) => (p.env === 'client' ? (p.payload.updates ?? []).map((u) => u.path) : []));
}
