import {beforeAll, describe, expect, mock, test} from 'bun:test';
import path from 'node:path';
import type {Plugin} from 'vite';
import * as vite from 'vite';
import {markdoc} from '../../src/vite/plugin';
import {moduleShape} from '../helpers/ast';
import {writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {callConfigResolved, callTransform, fakePluginContext} from '../helpers/plugin-context';

const fx = tmpDirFor(import.meta);
const schemaDir = path.join(fx, 'markdoc');
const elsewhere = path.join(schemaDir, 'elsewhere.ts');
const pageId = path.join(fx, 'pages/t.md');

beforeAll(() => {
  writeTree(fx, {'markdoc/tags.ts': 'export default {};\n', 'markdoc/elsewhere.ts': 'export default {};\n'});
});

/** `./config` の解決結果を `config` に固定したコンテキストで変換する。他のエントリは解決しない。 */
async function transformWithConfigResolution(config: () => Promise<{id: string; external: boolean} | null>) {
  const plugin = markdoc({dir: fx});
  callConfigResolved(plugin, {root: fx, command: 'serve'});
  const ctx = fakePluginContext({resolve: async (request) => (request === './config' ? config() : null)});
  return (await callTransform(plugin, ctx, '# x\n', pageId))?.code ?? '';
}

describe('transform: schema resolution through this.resolve', () => {
  for (const [label, result] of [
    ['an external id', {id: elsewhere, external: true}],
    ['a \\0 virtual id', {id: `\0${elsewhere}`, external: false}],
    ['a query id of a missing file', {id: `${path.join(schemaDir, 'missing.ts')}?v=1`, external: false}],
    ['a directory', {id: schemaDir, external: false}],
  ] as const) {
    test(`${label} is not used; the filesystem has no config → const config = {}`, async () => {
      expect(await transformWithConfigResolution(async () => result)).toContain('const config = {};');
    });
  }

  test('a query id of an existing file is used without the query', async () => {
    const code = await transformWithConfigResolution(async () => ({id: `${elsewhere}?v=1`, external: false}));
    expect(code).toContain('import * as config from "../markdoc/elsewhere.ts";');
  });

  test('a resolver that throws falls back to the filesystem', async () => {
    const plugin = markdoc({dir: fx});
    callConfigResolved(plugin, {root: fx, command: 'serve'});
    const ctx = fakePluginContext({
      resolve: async () => {
        throw new Error('RESOLVER-FAILED');
      },
    });
    const code = (await callTransform(plugin, ctx, '# x\n', pageId))?.code ?? '';
    expect(code).toContain('import * as tags from "../markdoc/tags.ts";');
    expect(code).toContain('const config = {};');
  });
});

describe('transform: watch registration of missing schema entries', () => {
  const configCandidate = path.join(schemaDir, 'config.ts');
  const watchFilesFor = async (command: 'serve' | 'build', watchMode: boolean): Promise<string[]> => {
    const plugin = markdoc({dir: fx});
    callConfigResolved(plugin, {root: fx, command});
    const watched: string[] = [];
    await callTransform(plugin, fakePluginContext({watchMode, watched}), '# x\n', pageId);
    return watched;
  };

  test('build --watch watches candidate paths of missing entries', async () => {
    expect(await watchFilesFor('build', true)).toContain(configCandidate);
  });

  test('a one-off build and serve do not', async () => {
    expect(await watchFilesFor('build', false)).not.toContain(configCandidate);
    expect(await watchFilesFor('serve', true)).not.toContain(configCandidate);
  });

  test('build --watch with a schema dir containing the root watches neither the dir nor the candidates', async () => {
    const root = path.join(fx, 'nested-root');
    const plugin = markdoc({dir: root, schemaPath: '..'});
    callConfigResolved(plugin, {root, command: 'build'});
    const watched: string[] = [];
    await callTransform(plugin, fakePluginContext({watchMode: true, watched}), '# x\n', path.join(root, 'pages/t.md'));
    // fx にエントリはないため、監視するファイルはない。
    expect(watched).toEqual([]);
  });
});

describe('transform: ids', () => {
  const plugin = markdoc({dir: fx, fastRefresh: true});
  const transform = (id: string) => callTransform(plugin, fakePluginContext(), '# x\n', id);

  test('?markdoc-component returns the component module (default export only)', async () => {
    const result = await transform(`${pageId}?markdoc-component`);
    expect(moduleShape(result?.code ?? '').exports).toEqual(['default']);
  });

  test('ids the filter would reject (?raw, node_modules) return null', async () => {
    expect(await transform(`${pageId}?raw`)).toBeNull();
    expect(await transform(path.join(fx, 'node_modules/pkg/readme.md'))).toBeNull();
  });
});

describe("transform: compile: 'build' fallbacks", () => {
  const root = path.join(fx, 'fallbacks');
  const page = path.join(root, 'pages/f.md');
  beforeAll(() => {
    writeTree(root, {
      'markdoc/tags.ts':
        "import {TYPE} from './dep';\n" +
        "export default {callout: {render: 'aside', attributes: {type: {type: String, default: TYPE}}}};\n",
      'markdoc/dep.ts': "export const TYPE = 'NATIVE-IMPORT-DEFAULT';\n",
    });
  });

  /** handler を `this` と第 3 引数を指定して呼ぶ。 */
  const callHandler = async (plugin: Plugin, ctx: unknown, options: unknown) => {
    const handler = (plugin.transform as {handler: (this: unknown, ...a: unknown[]) => unknown}).handler;
    return (await handler.call(ctx, '{% callout %}x{% /callout %}\n', page, options)) as {code: string; map: unknown};
  };

  test('without vite.runnerImport the schema is imported natively, without dependencies to watch', async () => {
    const realVite = {...vite};
    mock.module('vite', () => ({...realVite, runnerImport: undefined}));
    try {
      expect(vite.runnerImport).toBeUndefined();
      const plugin = markdoc({dir: root, compile: 'build'});
      callConfigResolved(plugin, {root, command: 'serve'});
      const watched: string[] = [];
      const result = await callHandler(plugin, fakePluginContext({watched}), {});
      expect(result.code).toContain('NATIVE-IMPORT-DEFAULT');
      // runnerImport は dep.ts を依存ファイルとして返す。ネイティブの import() は返さない。
      expect(watched).not.toContain(path.join(root, 'markdoc/dep.ts'));
    } finally {
      mock.module('vite', () => realVite);
    }
    expect(typeof vite.runnerImport).toBe('function');
  });

  test('without this.environment the consumer follows options.ssr', async () => {
    const plugin = markdoc({dir: root, compile: 'build'});
    callConfigResolved(plugin, {root, command: 'serve'});
    const {environment: _, ...ctx} = fakePluginContext();
    // client の prebuilt モジュールのみ、マップを `{mappings: ''}` にする。
    expect((await callHandler(plugin, ctx, {ssr: false})).map).toEqual({mappings: ''});
    expect((await callHandler(plugin, ctx, {ssr: true})).map).not.toEqual({mappings: ''});
  });
});

describe("transform: compile: 'build' schema evaluation", () => {
  const root = path.join(fx, 'define');
  beforeAll(() => {
    writeTree(root, {
      'markdoc/tags.ts':
        'const VERSION: string = __DOCS_VERSION__;\n' +
        "export default {callout: {render: 'aside', attributes: {v: {type: String, default: VERSION}}}};\n",
    });
  });

  test('the app define is applied to schema files', async () => {
    const plugin = markdoc({dir: root, compile: 'build'});
    callConfigResolved(plugin, {root, command: 'build', define: {__DOCS_VERSION__: JSON.stringify('DEFINED-1.2.3')}});
    const code = (
      await callTransform(plugin, fakePluginContext(), '{% callout %}x{% /callout %}\n', path.join(root, 'pages/d.md'))
    )?.code;
    expect(code).toContain('DEFINED-1.2.3');
  });
});
