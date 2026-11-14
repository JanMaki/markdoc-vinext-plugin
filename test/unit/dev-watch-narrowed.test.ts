import {describe, expect, test} from 'bun:test';
import path from 'node:path';
import {normalizePath} from 'vite';
import {createConfigResolvedHook} from '../../src/vite/config-hooks';
import {createConfigureServerHook, createWatchChangeHook} from '../../src/vite/dev-watch';
import {createHotUpdateHook} from '../../src/vite/hot-update';
import {createPluginState} from '../../src/vite/state';
import {sleep} from '../helpers/code';
import {DEBOUNCE_SETTLED_MS, fakeEnvironment, fakeServer} from '../helpers/fake-dev-server';
import {trySymlink, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';

const fx = tmpDirFor(import.meta);
/** schemaPath '..' でスキーマフォルダになる、ルートを含むフォルダ。 */
const ws = path.join(fx, 'ws');
const root = path.join(ws, 'proj');
const pageFile = path.join(root, 'pages/w.md');

writeTree(ws, {
  'tags.ts': 'export default {};\n',
  'partials/p.md': 'P\n',
  'sibling/x.ts': 'export {};\n',
  'proj/pages/w.md': '# w\n',
  'proj/other.ts': 'export {};\n',
});

/** configResolved と configureServer を済ませた状態と、各フックを呼ぶ関数。`cleared` は以降のキャッシュの消去回数。 */
function setup(options: {dir: string; schemaPath?: string}) {
  const state = createPluginState(options);
  (createConfigResolvedHook(state) as (c: unknown) => void)({
    root: options.dir,
    command: 'serve',
    resolve: {alias: []},
    logger: {warn: () => undefined, info: () => undefined},
  });
  // configResolved もキャッシュを消去するため、ここからの消去回数を数える。
  const startGeneration = state.cache.generation;
  state.markdocFiles.add(normalizePath(pageFile));
  const env = fakeEnvironment(normalizePath(pageFile));
  const fake = fakeServer({client: env.env});
  (createConfigureServerHook(state) as (s: unknown) => void)(fake.server);
  const watchChange = createWatchChangeHook(state) as (id: string, change: {event: 'update'}) => void;
  const hotUpdate = createHotUpdateHook(state) as (
    this: unknown,
    o: {type: string; file: string; modules: unknown[]},
  ) => unknown;
  return {
    state,
    env,
    cleared: () => state.cache.generation - startGeneration,
    ...fake,
    change: (file: string) => watchChange(file, {event: 'update'}),
    hot: (type: string, file: string) => hotUpdate.call({environment: env.env}, {type, file, modules: []}),
  };
}

describe('schema dir containing the project root (narrowed)', () => {
  const narrowed = () => setup({dir: root, schemaPath: '..'});

  test('configResolved marks the watch as narrowed; only the existing partials folder is added to the watcher', () => {
    const s = narrowed();
    expect(s.state.narrowSchemaWatch).toBe(true);
    expect(s.added).toEqual([path.join(ws, 'partials')]);
  });

  test('add / unlink / addDir outside partials and the entry candidates are ignored', async () => {
    const s = narrowed();
    s.watcher.emit('add', path.join(root, 'other.ts'));
    s.watcher.emit('unlink', path.join(root, 'pages/old.md'));
    s.watcher.emit('add', path.join(ws, 'sibling/y.ts'));
    s.watcher.emit('addDir', path.join(root, 'components'));
    await sleep(DEBOUNCE_SETTLED_MS);
    expect([s.cleared(), s.env.invalidated, s.env.sent]).toEqual([0, [], []]);
  });

  for (const [event, rel] of [
    ['add', 'config.ts'],
    ['add', 'tags/index.ts'],
    ['unlink', 'partials/p.md'],
    ['addDir', 'partials/sub'],
  ] as const) {
    test(`${event} of ${rel} in the schema dir clears the cache and invalidates`, async () => {
      const s = narrowed();
      s.watcher.emit(event, path.join(ws, rel));
      await sleep(DEBOUNCE_SETTLED_MS);
      expect(s.cleared()).toBe(1);
      expect(s.env.invalidated).toHaveLength(1);
    });
  }

  test('watchChange: project files keep the caches; entries clear resolution; partials clear partials only', () => {
    const s = narrowed();
    s.state.cache.schemaEntries.set('key', null);
    s.change(path.join(root, 'other.ts'));
    s.change(path.join(ws, 'sibling/x.ts'));
    expect([s.cleared(), s.state.cache.schemaEntries.size]).toEqual([0, 1]);
    s.change(path.join(ws, 'partials/p.md'));
    expect([s.cleared(), s.state.cache.schemaEntries.size]).toEqual([1, 1]);
    s.change(path.join(ws, 'tags.ts'));
    expect([s.cleared(), s.state.cache.schemaEntries.size]).toEqual([2, 0]);
  });

  test('hotUpdate: a created project file keeps the default handling; a created entry reloads', () => {
    const s = narrowed();
    expect(s.hot('create', path.join(root, 'pages/new.md'))).toBeUndefined();
    expect(s.env.sent).toEqual([]);
    expect(s.hot('create', path.join(ws, 'config.ts'))).toEqual([]);
    expect(s.env.sent).toEqual([{type: 'full-reload'}]);
  });
});

describe('schema dir equal to the project root (narrowed)', () => {
  test('only entry candidates and partials are schema files; no partials folder → nothing is added', async () => {
    const s = setup({dir: root, schemaPath: '.'});
    expect(s.added).toEqual([]);
    s.watcher.emit('add', path.join(root, 'other.ts'));
    await sleep(DEBOUNCE_SETTLED_MS);
    expect(s.env.invalidated).toEqual([]);
    s.watcher.emit('add', path.join(root, 'nodes.tsx'));
    await sleep(DEBOUNCE_SETTLED_MS);
    expect(s.env.invalidated).toHaveLength(1);
  });
});

describe('linked schema dir: events on the real path', () => {
  const realSchema = path.join(fx, 'real-markdoc');
  const linkedRoot = path.join(fx, 'linked-proj');
  writeTree(realSchema, {'tags.ts': 'export default {};\n', 'partials/p.md': 'P\n'});
  writeTree(linkedRoot, {'pages/w.md': '# w\n'});
  // skipIf の判定に使うため、収集時に作成する。
  const linked = trySymlink(realSchema, path.join(linkedRoot, 'markdoc'), 'junction');
  // ルートを含むフォルダへのリンク。実パス側の候補パスで判定する。
  const linkedWs = trySymlink(ws, path.join(fx, 'ws-link'), 'junction');

  test.skipIf(!linked)('watchChange on the real path of an entry and a partial', () => {
    const s = setup({dir: linkedRoot});
    s.state.cache.schemaEntries.set('key', null);
    s.change(path.join(realSchema, 'partials/p.md'));
    expect([s.cleared(), s.state.cache.schemaEntries.size]).toEqual([1, 1]);
    s.change(path.join(realSchema, 'tags.ts'));
    expect([s.cleared(), s.state.cache.schemaEntries.size]).toEqual([2, 0]);
  });

  test.skipIf(!linked)('hotUpdate and watcher add on the real path reload and invalidate', async () => {
    const s = setup({dir: linkedRoot});
    expect(s.hot('create', path.join(realSchema, 'config.ts'))).toEqual([]);
    expect(s.env.sent).toEqual([{type: 'full-reload'}]);
    const before = s.env.invalidated.length;
    s.watcher.emit('add', path.join(realSchema, 'nodes.ts'));
    await sleep(DEBOUNCE_SETTLED_MS);
    expect(s.env.invalidated).toHaveLength(before + 1);
  });

  test.skipIf(!linkedWs)('narrowed: an entry candidate on the real path is a schema file; a sibling is not', () => {
    const s = setup({dir: root, schemaPath: path.join(fx, 'ws-link')});
    expect(s.state.narrowSchemaWatch).toBe(true);
    s.change(path.join(ws, 'sibling/x.ts'));
    expect(s.cleared()).toBe(0);
    s.change(path.join(ws, 'config.ts'));
    expect(s.cleared()).toBe(1);
    s.change(path.join(fx, 'ws-link', 'config.ts'));
    expect(s.cleared()).toBe(2);
  });

  // partials フォルダの実体がルートを含む。
  const broadWs = path.join(fx, 'broad-ws');
  writeTree(broadWs, {'proj/pages/w.md': '# w\n'});
  const linkedPartials = trySymlink(path.join(broadWs, 'proj'), path.join(broadWs, 'partials'), 'junction');

  test.skipIf(!linkedPartials)('narrowed: a partials folder whose real path contains the root is not watched', () => {
    const s = setup({dir: path.join(broadWs, 'proj'), schemaPath: '..'});
    expect(s.state.narrowSchemaWatch).toBe(true);
    expect(s.added).toEqual([]);
    expect(s.warned).toHaveLength(1);
    expect(s.warned[0]).toContain('was not added to the watcher');
  });
});

describe('partials folder linked to a too broad directory', () => {
  // 実体がルートを含むフォルダ。ドライブのルートへのリンクは、フィクスチャの走査・削除が全ドライブに及ぶ恐れがあるため作らない。
  const nnProj = path.join(fx, 'nn', 'proj');
  writeTree(nnProj, {'pages/w.md': '# w\n'});
  const nnSchema = path.join(fx, 'nn', 'schema');
  writeTree(nnSchema, {'tags.ts': 'export default {};\n'});
  const nnLink = trySymlink(nnProj, path.join(nnSchema, 'partials'), 'junction');
  test.skipIf(!nnLink)('non-narrowed: the partials folder containing the root is unwatched with one warning', () => {
    const s = setup({dir: nnProj, schemaPath: '../schema'});
    expect(s.state.narrowSchemaWatch).toBe(false);
    expect(s.added).toEqual([nnSchema]);
    expect(s.unwatched).toEqual([path.join(nnSchema, 'partials')]);
    expect(s.warned).toHaveLength(1);
    expect(s.warned[0]).toContain('was not added to the watcher');
  });
});

describe.skipIf(process.platform !== 'win32' && process.platform !== 'darwin')(
  'narrowed entry candidates on a case-insensitive platform',
  () => {
    for (const rel of ['Tags.ts', 'TAGS.TS', 'Tags/Index.ts']) {
      test(`${rel} is an entry candidate`, () => {
        const s = setup({dir: root, schemaPath: '..'});
        s.change(path.join(ws, rel));
        expect(s.cleared()).toBe(1);
      });
    }
  },
);
