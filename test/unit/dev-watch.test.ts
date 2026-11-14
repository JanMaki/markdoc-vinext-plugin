import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type {ViteDevServer} from 'vite';
import {normalizePath} from 'vite';
import {SCHEMA_ENTRIES} from '../../src/codegen/names';
import type {MarkdocVitePluginOptions} from '../../src/types';
import {createConfigResolvedHook} from '../../src/vite/config-hooks';
import {createConfigureServerHook, createWatchChangeHook} from '../../src/vite/dev-watch';
import {markdoc} from '../../src/vite/plugin';
import {createPluginState} from '../../src/vite/state';
import {sleep} from '../helpers/code';
import {DEBOUNCE_SETTLED_MS, fakeEnvironment, fakeServer} from '../helpers/fake-dev-server';
import {trySymlink, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {callConfigResolved, callTransform, callWatchChange, fakePluginContext} from '../helpers/plugin-context';

const fx = tmpDirFor(import.meta);
const schemaDir = path.join(fx, 'markdoc');
const partialFile = path.join(schemaDir, 'partials/p.md');
const tagsFile = path.join(schemaDir, 'tags.ts');
const pageFile = path.join(fx, 'pages/w.md');
beforeAll(() => {
  writeTree(fx, {
    'markdoc/tags.ts': 'export default {};\n',
    'markdoc/partials/p.md': 'WC-PARTIAL-INITIAL\n',
    'other.ts': 'export {};\n',
  });
});

/** 偽の dev サーバで configureServer を呼んだプラグイン。pageFile は変換済み。 */
async function devSetup(options: MarkdocVitePluginOptions = {}) {
  const plugin = markdoc({dir: fx, ...options});
  callConfigResolved(plugin, {root: fx, command: 'serve'});
  await callTransform(plugin, fakePluginContext(), '# x\n', pageFile);
  const client = fakeEnvironment(normalizePath(pageFile));
  const ssr = fakeEnvironment(normalizePath(pageFile));
  const fake = fakeServer({client: client.env, ssr: ssr.env});
  (plugin.configureServer as (s: unknown) => void)(fake.server);
  return {...fake, envs: [client, ssr]};
}

describe('configureServer', () => {
  test('the schema dir is added to the watcher', async () => {
    expect((await devSetup()).added).toEqual([schemaDir]);
  });

  test('close removes the dev server and the pending debounce, then calls the original close', async () => {
    const state = createPluginState({dir: fx, compile: 'build'});
    state.markdocFiles.add(normalizePath(pageFile));
    const env = fakeEnvironment(normalizePath(pageFile));
    const fake = fakeServer({client: env.env});
    (createConfigureServerHook(state) as (s: unknown) => void)(fake.server);
    fake.watcher.emit('add', path.join(schemaDir, 'config.ts'));
    await fake.server.close();
    await sleep(DEBOUNCE_SETTLED_MS);
    expect([state.devServers.size, env.invalidated, fake.counts.closed]).toEqual([0, [], 1]);
  });

  test('three adds in the schema dir are debounced into one invalidation per environment, no reload', async () => {
    const s = await devSetup();
    for (const name of ['config.ts', 'nodes.ts', 'partials/q.md']) s.watcher.emit('add', path.join(schemaDir, name));
    await sleep(DEBOUNCE_SETTLED_MS);
    for (const e of s.envs) {
      expect(e.invalidated).toHaveLength(1);
      expect(e.sent).toEqual([]);
    }
  });

  test('addDir / unlinkDir in the schema dir send a full-reload to every environment', async () => {
    for (const event of ['addDir', 'unlinkDir']) {
      const s = await devSetup();
      s.watcher.emit(event, path.join(schemaDir, 'partials/sub'));
      await sleep(DEBOUNCE_SETTLED_MS);
      for (const e of s.envs) {
        expect(e.sent).toEqual([{type: 'full-reload'}]);
        expect(e.invalidated).toHaveLength(1);
      }
    }
  });

  test('addDir / unlinkDir in the schema dir clear the real-path cache of isInSchemaDir', async () => {
    for (const event of ['addDir', 'unlinkDir']) {
      const state = createPluginState({dir: fx});
      const fake = fakeServer({});
      (createConfigureServerHook(state) as (s: unknown) => void)(fake.server);
      state.realSchemaDirs.set(schemaDir, path.join(fx, 'stale-real'));
      fake.watcher.emit(event, path.join(schemaDir, 'partials/sub'));
      expect(state.realSchemaDirs.size).toBe(0);
      await fake.server.close();
    }
  });

  test('events outside the schema dir are ignored', async () => {
    const s = await devSetup();
    s.watcher.emit('add', path.join(fx, 'pages/new.md'));
    s.watcher.emit('addDir', path.join(fx, 'pages/sub'));
    await sleep(DEBOUNCE_SETTLED_MS);
    for (const e of s.envs) expect([e.invalidated, e.sent]).toEqual([[], []]);
  });

  test('unlink of a transformed Markdoc file removes it from the files to invalidate', async () => {
    const s = await devSetup();
    s.watcher.emit('unlink', pageFile);
    s.watcher.emit('add', path.join(schemaDir, 'config.ts'));
    await sleep(DEBOUNCE_SETTLED_MS);
    for (const e of s.envs) expect(e.invalidated).toEqual([]);
  });
});

describe('unlink of a linked Markdoc file', () => {
  const realPages = path.join(fx, 'real-pages');
  const linkPages = path.join(fx, 'link-pages');
  writeTree(realPages, {'a.md': '# a\n'});
  // skipIf の判定に使うため、収集時に作成する。
  const linked = trySymlink(realPages, linkPages, 'junction');

  test.skipIf(!linked)('removes the real path registered by the transform', () => {
    const state = createPluginState({dir: fx});
    state.markdocFiles.add(normalizePath(path.join(realPages, 'a.md')));
    const fake = fakeServer({});
    (createConfigureServerHook(state) as (s: unknown) => void)(fake.server);
    fs.rmSync(path.join(realPages, 'a.md'));
    fake.watcher.emit('unlink', path.join(linkPages, 'a.md'));
    expect([...state.markdocFiles]).toEqual([]);
  });
});

describe('isInSchemaDir real-path cache', () => {
  test('a cached real path is reused by watchChange and cleared by configResolved', () => {
    const state = createPluginState({dir: fx});
    const watchChange = createWatchChangeHook(state) as (id: string, change: {event: 'update'}) => void;
    watchChange(path.join(fx, 'other.ts'), {event: 'update'});
    expect(state.realSchemaDirs.has(schemaDir)).toBe(true);
    // 実パスを再計算すれば、sentinel の中のファイルはスキーマフォルダ外になる。
    const sentinel = path.join(fx, 'sentinel-real');
    state.realSchemaDirs.set(schemaDir, sentinel);
    watchChange(path.join(sentinel, 'tags.ts'), {event: 'update'});
    expect(state.realSchemaDirs.get(schemaDir)).toBe(sentinel);
    expect(state.cache.generation).toBe(1);
    const configResolved = createConfigResolvedHook(state) as (c: unknown) => void;
    configResolved({root: fx, command: 'serve', resolve: {alias: []}, logger: {warn: () => undefined}});
    expect(state.realSchemaDirs.size).toBe(0);
  });
});

describe('watchChange', () => {
  test('unrelated files keep the caches; partial edits clear partials only; schema edits clear resolution', async () => {
    const plugin = markdoc({dir: fx});
    callConfigResolved(plugin, {root: fx, command: 'serve'});
    let resolves = 0;
    const ctx = fakePluginContext({onResolve: () => resolves++});
    const transform = async () => (await callTransform(plugin, ctx, '{% partial file="p.md" /%}\n', pageFile))?.code;

    // 解決はエントリごとに 1 回。
    const perTransform = SCHEMA_ENTRIES.length;
    expect(await transform()).toContain('WC-PARTIAL-INITIAL');
    expect(resolves).toBe(perTransform);

    fs.writeFileSync(partialFile, 'WC-PARTIAL-UPDATED\n');
    callWatchChange(plugin, path.join(fx, 'other.ts'));
    expect(await transform()).toContain('WC-PARTIAL-INITIAL');
    expect(resolves).toBe(perTransform);

    callWatchChange(plugin, `${partialFile}?t=1`);
    expect(await transform()).toContain('WC-PARTIAL-UPDATED');
    expect(resolves).toBe(perTransform);

    callWatchChange(plugin, tagsFile);
    await transform();
    expect(resolves).toBe(2 * perTransform);
  });

  /** スキーマフォルダ外の依存ファイルを cache.deps に持つ状態と、偽の dev サーバ。 */
  function depsSetup(compile: 'runtime' | 'build', withServer: boolean) {
    const state = createPluginState({dir: fx, compile});
    const dep = path.join(fx, 'components/dep.ts');
    state.cache.deps.add(dep);
    state.markdocFiles.add(normalizePath(pageFile));
    const env = fakeEnvironment(normalizePath(pageFile));
    if (withServer) state.devServers.add({environments: {client: env.env}} as unknown as ViteDevServer);
    const hook = createWatchChangeHook(state) as (id: string, change: {event: 'update'}) => void;
    return {state, env, change: () => hook(dep, {event: 'update'})};
  }

  test("a schema dependency outside the schema dir clears the cache and, with compile: 'build', invalidates pages", () => {
    const s = depsSetup('build', true);
    s.change();
    expect(s.state.cache.generation).toBe(1);
    expect(s.env.invalidated).toHaveLength(1);
  });

  test("a schema dependency with compile: 'runtime' or without a dev server only clears the cache", () => {
    for (const [compile, withServer] of [
      ['runtime', true],
      ['build', false],
    ] as const) {
      const s = depsSetup(compile, withServer);
      s.change();
      expect(s.state.cache.generation).toBe(1);
      expect(s.env.invalidated).toEqual([]);
    }
  });

  test("every live dev server receives the compile: 'build' invalidation; a closed one does not", async () => {
    const state = createPluginState({dir: fx, compile: 'build'});
    const dep = path.join(fx, 'components/dep.ts');
    state.cache.deps.add(dep);
    state.markdocFiles.add(normalizePath(pageFile));
    const envs = [0, 1, 2].map(() => fakeEnvironment(normalizePath(pageFile)));
    const servers = envs.map((e) => fakeServer({client: e.env}).server);
    for (const server of servers) (createConfigureServerHook(state) as (s: unknown) => void)(server);
    // 後から登録されたサーバ (再起動に失敗したもの等) が閉じても、残りのサーバは無効化の対象のまま。
    await servers[2]?.close();
    (createWatchChangeHook(state) as (id: string, change: {event: 'update'}) => void)(dep, {event: 'update'});
    expect(envs.map((e) => e.invalidated.length)).toEqual([1, 1, 0]);
  });
});
