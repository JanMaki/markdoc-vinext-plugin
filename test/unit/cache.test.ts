import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {clearMarkdocCache, clearPartialCache, createMarkdocCache} from '../../src/cache';
import {SCHEMA_ENTRIES} from '../../src/codegen/names';
import {transformMarkdoc} from '../../src/transform';
import type {MarkdocCache, SchemaModule} from '../../src/types';
import {canSymlink, trySymlink, writeFile, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';

const dir = tmpDirFor(import.meta);
const symlinks = canSymlink(dir);
/** 変換 1 回あたりのリゾルバの呼び出し回数 (エントリごとに 1 回)。 */
const RESOLVES_PER_TRANSFORM = SCHEMA_ENTRIES.length;

/** テストごとの partial のフィクスチャと、解決の回数を数えるリゾルバ付きの変換。 */
function partialFixture(name: string) {
  const root = path.join(dir, name);
  const partialFile = path.join(root, 'markdoc/partials/p.md');
  writeTree(root, {'markdoc/tags.ts': 'export default {};\n', 'outside.md': 'OUTSIDE-SECRET\n'});
  writeFile(partialFile, 'PARTIAL-INITIAL\n');
  const cache = createMarkdocCache();
  const counter = {resolves: 0};
  const transform = () =>
    transformMarkdoc('{% partial file="p.md" /%}\n', {
      resourcePath: path.join(root, 'pages/x.md'),
      root,
      options: {},
      cache,
      resolve: async (base, request) => {
        counter.resolves++;
        const file = path.resolve(base, `${request}.ts`);
        return fs.existsSync(file) ? file : null;
      },
    });
  return {root, partialFile, cache, counter, transform};
}

describe('schema resolution and partial cache', () => {
  test('a cache hit serves the cached partial without resolving; clearMarkdocCache re-reads and re-resolves', async () => {
    const fx = partialFixture('hit');
    expect((await fx.transform()).code).toContain('PARTIAL-INITIAL');
    expect(fx.counter.resolves).toBe(RESOLVES_PER_TRANSFORM);

    fs.writeFileSync(fx.partialFile, 'PARTIAL-UPDATED\n');
    expect((await fx.transform()).code).toContain('PARTIAL-INITIAL');
    expect(fx.counter.resolves).toBe(RESOLVES_PER_TRANSFORM);

    clearMarkdocCache(fx.cache);
    expect(fx.cache.generation).toBe(1);
    expect((await fx.transform()).code).toContain('PARTIAL-UPDATED');
    expect(fx.counter.resolves).toBe(2 * RESOLVES_PER_TRANSFORM);
  });

  test('clearPartialCache drops partials only and increments the generation', async () => {
    const fx = partialFixture('partial-only');
    await fx.transform();
    clearPartialCache(fx.cache);
    expect(fx.cache.partials.size).toBe(0);
    expect(fx.cache.schemaEntries.size).toBe(SCHEMA_ENTRIES.length);
    expect(fx.cache.generation).toBe(1);
  });

  test('partial read race: content cleared mid-read is returned but not cached', async () => {
    const fx = partialFixture('race');
    const partialReal = fs.realpathSync(fx.partialFile);
    const fsPromises = fs.promises as {readFile: typeof fs.promises.readFile};
    const originalReadFile = fsPromises.readFile;
    let clearedDuringRead = false;
    try {
      // partial の読み込み中に clearMarkdocCache を呼ぶ。
      fsPromises.readFile = (async (...args: Parameters<typeof originalReadFile>) => {
        const content = await originalReadFile(...args);
        if (!clearedDuringRead && String(args[0]) === partialReal) {
          clearedDuringRead = true;
          clearMarkdocCache(fx.cache);
        }
        return content;
      }) as typeof originalReadFile;
      expect((await fx.transform()).code).toContain('PARTIAL-INITIAL');
    } finally {
      fsPromises.readFile = originalReadFile;
    }
    expect(clearedDuringRead).toBe(true);
    expect(fx.cache.partials.size).toBe(0);
  });

  test('partial read without a concurrent clear is cached under the real path', async () => {
    const fx = partialFixture('cached');
    await fx.transform();
    expect([...fx.cache.partials.keys()]).toEqual([fs.realpathSync(fx.partialFile)]);
  });

  test.skipIf(!symlinks)(
    'a cached partial swapped for an escaping symlink is rejected without invalidation',
    async () => {
      const fx = partialFixture('swap');
      await fx.transform();
      expect(trySymlink(path.join(fx.root, 'outside.md'), fx.partialFile)).toBe(true);
      await expect(fx.transform()).rejects.toThrow('symlink');
    },
  );

  test('a deleted partial is not served from the cache', async () => {
    const fx = partialFixture('deleted');
    await fx.transform();
    fs.rmSync(fx.partialFile);
    await expect(fx.transform()).rejects.toThrow('was not found');
  });
});

describe('schema entry cache generation guard', () => {
  const root = path.join(dir, 'generation');
  const transform = (cache: MarkdocCache, resolve: (d: string, r: string) => Promise<string | null>) =>
    transformMarkdoc('hi\n', {resourcePath: path.join(root, 'pages/gen.md'), root, options: {}, cache, resolve});
  beforeAll(() => writeFile(path.join(root, 'markdoc/config.ts'), 'export default {};\n'));

  test('a resolve result is not cached when the cache is cleared during resolution', async () => {
    const cache = createMarkdocCache();
    await transform(cache, async (_dir, request) => {
      if (request === './config') clearMarkdocCache(cache);
      return null;
    });
    expect([...cache.schemaEntries.keys()].map((key) => key.split('\0')[1])).toEqual(['tags', 'nodes', 'functions']);
  });

  test('a resolve result is cached when the generation is unchanged', async () => {
    const cache = createMarkdocCache();
    await transform(cache, async () => null);
    expect(cache.schemaEntries.size).toBe(SCHEMA_ENTRIES.length);
  });
});

describe("compile: 'build' schema module cache", () => {
  const root = path.join(dir, 'schema-module');
  const tagsFile = path.join(root, 'markdoc/tags.ts');
  const dep = path.join(root, 'components/dep.ts');
  // skipIf の判定にリンクを使うため、収集時に作成する。
  writeFile(tagsFile, 'export default {};\n');
  writeFile(dep, 'export default 1;\n');
  const linkedDir = path.join(root, 'linked-components');
  const linked = trySymlink(path.join(root, 'components'), linkedDir, 'junction');

  /** import を数え、`fail` が true の間は失敗する importModule と、それを使う変換。`dependencies` は import の依存ファイル。 */
  function schemaModuleFixture(dependencies = [dep], narrowSchemaWatch = false) {
    const cache = createMarkdocCache();
    const state = {imports: 0, fail: false};
    const importModule = async (file: string): Promise<SchemaModule> => {
      state.imports++;
      if (state.fail) throw new Error(`IMPORT-FAILED ${file}`);
      const callout = {render: 'aside', attributes: {type: {type: String, default: 'SCHEMA-MODULE-DEFAULT'}}};
      return {module: {default: {callout}}, dependencies};
    };
    const transformPage = (name: string, watched: string[] = []) =>
      transformMarkdoc('{% callout %}x{% /callout %}\n', {
        resourcePath: path.join(root, `pages/${name}.md`),
        root,
        options: {compile: 'build'},
        cache,
        importModule,
        narrowSchemaWatch,
        addWatchFile: (f) => watched.push(f),
      });
    return {cache, state, transformPage};
  }

  test('two transforms sharing a cache import the schema once; both get the schema and watch its dependency', async () => {
    const {cache, state, transformPage} = schemaModuleFixture();
    const watchedA: string[] = [];
    const watchedB: string[] = [];
    const a = await transformPage('a', watchedA);
    const b = await transformPage('b', watchedB);
    expect(state.imports).toBe(1);
    expect([...cache.schemaModules.keys()]).toEqual([tagsFile]);
    for (const result of [a, b]) {
      expect(result.code).toContain('SCHEMA-MODULE-DEFAULT');
      expect(result.watchFiles).toContain(dep);
    }
    expect(watchedA).toContain(dep);
    expect(watchedB).toContain(dep);
    expect([...cache.deps]).toEqual([dep]);
  });

  test('clearMarkdocCache keeps cache.deps and drops schema modules', async () => {
    const {cache, transformPage} = schemaModuleFixture();
    await transformPage('a');
    clearMarkdocCache(cache);
    expect([...cache.deps]).toEqual([dep]);
    expect(cache.schemaModules.size).toBe(0);
  });

  test('a failed import fails the transform, is not cached, and the next transform retries', async () => {
    const {cache, state, transformPage} = schemaModuleFixture();
    state.fail = true;
    await expect(transformPage('a')).rejects.toThrow('IMPORT-FAILED');
    expect(cache.schemaModules.has(tagsFile)).toBe(false);
    state.fail = false;
    expect((await transformPage('a')).code).toContain('SCHEMA-MODULE-DEFAULT');
    expect(state.imports).toBe(2);
  });

  test('a failed import watches the schema folder', async () => {
    const {state, transformPage} = schemaModuleFixture();
    state.fail = true;
    const watched: string[] = [];
    await expect(transformPage('a', watched)).rejects.toThrow('IMPORT-FAILED');
    expect(watched).toContain(path.join(root, 'markdoc'));
  });

  test('a failed import with narrowSchemaWatch does not watch the schema folder', async () => {
    const {state, transformPage} = schemaModuleFixture([dep], true);
    state.fail = true;
    const watched: string[] = [];
    await expect(transformPage('a', watched)).rejects.toThrow('IMPORT-FAILED');
    expect(watched).toContain(tagsFile);
    expect(watched).not.toContain(path.join(root, 'markdoc'));
  });

  test.skipIf(!linked)(
    'a dependency through a linked folder is recorded under both its path and its real path',
    async () => {
      const linkedDep = path.join(linkedDir, 'dep.ts');
      const {cache, transformPage} = schemaModuleFixture([linkedDep]);
      await transformPage('a');
      expect([...cache.deps].sort()).toEqual([dep, linkedDep].sort());
    },
  );
});
