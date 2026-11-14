import {beforeAll, describe, expect, spyOn, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {createMarkdocCache} from '../../src/cache';
import {transformMarkdoc} from '../../src/transform';
import {trySymlink, writeFile, writeTree} from '../helpers/fixtures';
import {componentSample, exampleRoot, pagesSample, tmpDirFor} from '../helpers/paths';
import {fixtureTransform, type TransformResult, transformSample} from '../helpers/transform';

const dir = tmpDirFor(import.meta);

describe('schema resolution', () => {
  const fx = path.join(dir, 'fx');
  const schemaDir = path.join(fx, 'markdoc');
  const transform = fixtureTransform(fx);
  const resolveRel = async (base: string, request: string): Promise<string | null> => {
    const file = path.resolve(base, `${request}.ts`);
    return fs.existsSync(file) ? file : null;
  };
  const requests: string[] = [];
  const watched: string[] = [];
  let bareConfig: TransformResult;

  beforeAll(async () => {
    writeTree(fx, {
      'outside.md': 'OUTSIDE-PARTIALS secret\n',
      'markdoc/tags.ts': 'export default {};\n',
      // スキーマのエントリと同名の偽パッケージ
      'node_modules/config/package.json': '{"name":"config","main":"index.js"}',
      'node_modules/config/index.js': 'export default {variables: {product: "WRONG-PACKAGE-CONFIG"}};\n',
    });
    // bare の "config" を node_modules に解決し、"./config" もエイリアスで同じ場所に向けるリゾルバ
    const bareResolver = async (base: string, request: string): Promise<string | null> => {
      requests.push(request);
      if (request === 'config' || request === './config') return path.join(fx, 'node_modules/config/index.js');
      return resolveRel(base, request);
    };
    bareConfig = await transform(
      '# Hi\n',
      'pages/t.md',
      {},
      {resolve: bareResolver, addWatchFile: (f) => watched.push(f)},
    );
  });

  test('only ./-relative requests are made, one per entry', () => {
    expect(requests).toEqual(['./config', './tags', './nodes', './functions']);
  });

  test('a resolver result outside the schema dir (node_modules "config") is not imported → const config = {}', () => {
    expect(bareConfig.code).not.toContain('node_modules');
    expect(bareConfig.code).toContain('const config = {};');
  });

  test('an existing tags.ts is imported with a JSON-quoted relative path', () => {
    expect(bareConfig.code).toContain('import * as tags from "../markdoc/tags.ts";');
  });

  test('only resolved entries are watched, not the whole schema dir', () => {
    expect(watched).toEqual([path.join(schemaDir, 'tags.ts')]);
  });

  test('a resolver result outside the schema dir falls back to the filesystem', async () => {
    const outside = await transform('# Hi\n', 'pages/t.md', {}, {resolve: async () => path.join(fx, 'outside.md')});
    expect(outside.code).toContain('import * as tags from "../markdoc/tags.ts";');
  });

  test('a directory entry resolves to its index file', async () => {
    const root = path.join(dir, 'fx-dir-index');
    writeFile(path.join(root, 'markdoc/tags/index.ts'), 'export default {};\n');
    const result = await fixtureTransform(root)('# x\n');
    expect(result.code).toContain('import * as tags from "../markdoc/tags/index.ts";');
  });

  test('a directory entry without an index file is not resolved → const tags = {}', async () => {
    const root = path.join(dir, 'fx-dir-no-index');
    writeFile(path.join(root, 'markdoc/tags/other.ts'), 'export default {};\n');
    const result = await fixtureTransform(root)('# x\n');
    expect(result.code).not.toContain('import * as tags');
    expect(result.code).toContain('const tags = {};');
  });

  test('sample schema: components/*.tsx and the schema dir are not watched', async () => {
    const {watchFiles} = await transformSample(componentSample, {schemaPath: './markdoc'});
    expect(watchFiles.filter((f) => f.endsWith('.tsx') || f === path.join(exampleRoot, 'markdoc'))).toEqual([]);
  });
});

describe('schemaPath edge cases', () => {
  test('a missing default schema dir → const schema = {}', async () => {
    const result = await transformMarkdoc('# Hello\n', {
      resourcePath: path.join(dir, 'pages', 'orphan.md'),
      root: dir,
      options: {router: 'pages'},
    });
    expect(result.code).toContain('const schema = {};');
  });

  test('a missing custom schemaPath throws the official error', async () => {
    const run = transformMarkdoc('# Hello\n', {
      resourcePath: pagesSample,
      root: exampleRoot,
      options: {schemaPath: './does-not-exist-schema'},
    });
    await expect(run).rejects.toThrow(
      `Cannot find module './does-not-exist-schema' at '${path.join(exampleRoot, 'does-not-exist-schema')}'`,
    );
  });
});

describe('watchMissingSchemaEntries', () => {
  const root = path.join(dir, 'fx-watch-missing');
  const schemaDir = path.join(root, 'markdoc');
  const transform = (watchMissingSchemaEntries: boolean, narrowSchemaWatch = false) =>
    fixtureTransform(root)('# x\n', 'pages/t.md', {}, {watchMissingSchemaEntries, narrowSchemaWatch});
  beforeAll(() => writeFile(path.join(schemaDir, 'tags.ts'), 'export default {};\n'));

  test('true watches the schema dir and every candidate path of missing entries', async () => {
    const {watchFiles} = await transform(true);
    expect(watchFiles).toContain(schemaDir);
    for (const f of ['config.ts', 'config.js', 'config/index.ts', 'nodes.ts', 'functions/index.js']) {
      expect(watchFiles).toContain(path.join(schemaDir, f));
    }
    expect(watchFiles).not.toContain(path.join(schemaDir, 'tags.js'));
  });

  test('false watches only the resolved entries', async () => {
    expect((await transform(false)).watchFiles).toEqual([path.join(schemaDir, 'tags.ts')]);
  });

  test('true with narrowSchemaWatch watches only the resolved entries', async () => {
    expect((await transform(true, true)).watchFiles).toEqual([path.join(schemaDir, 'tags.ts')]);
  });
});

describe('watchMissingSchemaEntries with a too broad partials folder', () => {
  const root = path.join(dir, 'fx-watch-broad', 'proj');
  const schemaDir = path.join(dir, 'fx-watch-broad', 'schema');
  writeTree(root, {'pages/t.md': '# x\n'});
  writeTree(schemaDir, {'tags.ts': 'export default {};\n'});
  // 実体がルートを含む。
  const linked = trySymlink(root, path.join(schemaDir, 'partials'), 'junction');

  test.skipIf(!linked)('does not watch the schema dir; entry candidates are still watched', async () => {
    const {watchFiles} = await fixtureTransform(root)(
      '# x\n',
      'pages/t.md',
      {schemaPath: '../schema'},
      {watchMissingSchemaEntries: true},
    );
    expect(watchFiles).not.toContain(schemaDir);
    expect(watchFiles).toContain(path.join(schemaDir, 'config.ts'));
  });
});

describe('entry resolution failure', () => {
  const root = path.join(dir, 'fx-resolve-failure');
  beforeAll(() =>
    writeTree(root, {
      'markdoc/tags.ts': 'export default {};\n',
      'markdoc/nodes.ts': 'export default {};\n',
    }),
  );

  test('a failing entry is logged with console.debug, left out and not cached; the other entries still resolve', async () => {
    const cache = createMarkdocCache();
    // tags のキャッシュ書き込みで例外を投げ、エントリ解決の失敗を再現する。
    const set = cache.schemaEntries.set.bind(cache.schemaEntries);
    cache.schemaEntries.set = (key, value) => {
      if (key.endsWith('\0tags')) throw new Error('ENTRY-FAILED');
      return set(key, value);
    };
    const debug = spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      const {code} = await fixtureTransform(root)('# x\n', 'pages/t.md', {}, {cache});
      expect(code).not.toContain('import * as tags');
      expect(code).toContain('import * as nodes from "../markdoc/nodes.ts";');
      expect(debug).toHaveBeenCalledTimes(1);
      const [message, detail] = debug.mock.calls[0] as [string, {variable: string; error: Error}];
      expect(message).toBe('[markdoc-vinext] Failed to resolve');
      expect(detail.variable).toBe('tags');
      expect(detail.error.message).toBe('ENTRY-FAILED');
    } finally {
      debug.mockRestore();
    }
    expect([...cache.schemaEntries.keys()].map((key) => key.split('\0')[1])).toEqual(['config', 'nodes', 'functions']);
  });
});
