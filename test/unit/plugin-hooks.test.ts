import {beforeAll, describe, expect, test} from 'bun:test';
import path from 'node:path';
import {shouldTransformId} from '../../src/id';
import {INLINE_RUNTIME_SOURCE} from '../../src/runtime/source';
import {markdoc} from '../../src/vite/plugin';
import {writeFile} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {
  callConfigResolved,
  callTransform,
  fakePluginContext,
  filterIdOf,
  type HookWithFilter,
} from '../helpers/plugin-context';

const fx = tmpDirFor(import.meta);

describe('hook filters', () => {
  const plugin = markdoc();
  const t = plugin.transform as HookWithFilter;
  const r = plugin.resolveId as HookWithFilter;
  const l = plugin.load as HookWithFilter;
  const includeOf = (p = plugin) => (filterIdOf(p.transform) as {include: RegExp[]}).include;
  const passes = (id: string, filter = includeOf()): boolean => filter.some((re) => re.test(id));

  test('transform / resolveId / load are {filter, handler} objects', () => {
    expect([t, r, l].every((h) => h.filter?.id && typeof h.handler === 'function')).toBe(true);
  });

  test('transform filter accepts and rejects exactly what shouldTransformId does', () => {
    const ids = [
      '/x/a.md',
      '/x/a.mdoc',
      '/x/a.md?import',
      '/x/a.md?t=1',
      '/x/a.mdoc?v=abc',
      '/x/A.MD',
      '/x/a.md#hash',
      '/x/a.mdx',
      '/x/a.js',
      '/x/a.md.js',
      '/x/a.markdown',
    ];
    for (const options of [{}, {extensions: ['markdown']}]) {
      const include = includeOf(markdoc(options));
      for (const id of ids) expect([id, passes(id, include)]).toEqual([id, shouldTransformId(id, options)]);
    }
    // extension (RegExp) は、クエリ / ハッシュ付きの id を handler の再判定に委ねるため、受理側が上位集合になる。
    const options = {extension: /.mdx?$/g};
    const include = includeOf(markdoc(options));
    for (const id of ids) {
      if (shouldTransformId(id, options)) expect([id, passes(id, include)]).toEqual([id, true]);
      if (!/[?#]/.test(id)) expect([id, passes(id, include)]).toEqual([id, shouldTransformId(id, options)]);
    }
    // /g フラグは lastIndex の状態を持ち越すため除く。
    expect(include.filter((re) => re.global)).toEqual([]);
    expect(ids.filter((id) => passes(id))).toEqual(ids.slice(0, 7));
  });

  test('resolveId / load filters match the virtual runtime id only', () => {
    expect((filterIdOf(r) as RegExp).test('virtual:markdoc-vinext/runtime')).toBe(true);
    expect((filterIdOf(l) as RegExp).test('\0virtual:markdoc-vinext/runtime')).toBe(true);
    expect((filterIdOf(r) as RegExp).test('./x.md')).toBe(false);
  });
});

describe('virtual runtime module', () => {
  const plugin = markdoc();
  const call = (hook: unknown, id: string) => (hook as {handler: (id: string) => unknown}).handler.call({}, id);

  test('resolveId maps the runtime id to the \\0 id; load returns the runtime source', () => {
    expect(call(plugin.resolveId, 'virtual:markdoc-vinext/runtime')).toBe('\0virtual:markdoc-vinext/runtime');
    expect(call(plugin.load, '\0virtual:markdoc-vinext/runtime')).toBe(INLINE_RUNTIME_SOURCE);
  });

  test('other ids under the prefix are not handled', () => {
    expect(call(plugin.resolveId, 'virtual:markdoc-vinext/other')).toBeNull();
    expect(call(plugin.load, '\0virtual:markdoc-vinext/other')).toBeNull();
  });
});

describe('configResolved', () => {
  beforeAll(() => writeFile(path.join(fx, 'markdoc/config.ts'), 'export default {};\n'));

  test('clears the cache: schema entries are resolved again after configResolved', async () => {
    const plugin = markdoc({dir: fx});
    let resolves = 0;
    const ctx = fakePluginContext({onResolve: () => resolves++});
    const pageId = path.join(fx, 'pages/restart.md');
    callConfigResolved(plugin, {root: fx, command: 'serve'});
    await callTransform(plugin, ctx, 'hi\n', pageId);
    await callTransform(plugin, ctx, 'hi\n', pageId);
    expect(resolves).toBe(4);
    callConfigResolved(plugin, {root: fx, command: 'serve'});
    await callTransform(plugin, ctx, 'hi\n', pageId);
    expect(resolves).toBe(8);
  });

  test('warns when both extension and extensions are set', () => {
    const warns: string[] = [];
    callConfigResolved(markdoc({dir: fx, extension: /\.md$/, extensions: ['.mdoc']}), {
      root: fx,
      command: 'serve',
      warns,
    });
    expect(warns).toEqual([
      '[markdoc-vinext] Both `extension` and `extensions` are set; `extension` (RegExp) takes precedence.',
    ]);
  });
});
