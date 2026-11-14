import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {normalizePath} from 'vite';
import type {MarkdocVitePluginOptions} from '../../src/types';
import {markdoc} from '../../src/vite/plugin';
import {writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {callConfigResolved, callTransform, fakePluginContext} from '../helpers/plugin-context';

const fx = tmpDirFor(import.meta);
const pageFile = path.join(fx, 'pages/x.md');
const partialFile = path.join(fx, 'markdoc/partials/p.md');
const tagsFile = path.join(fx, 'markdoc/tags.ts');

beforeAll(() => {
  writeTree(fx, {
    'markdoc/tags.ts': 'export default {};\n',
    'markdoc/partials/p.md': 'P\n',
    'pages/x.md': '{% partial file="p.md" /%}\n',
  });
});

type FakeModule = {label: string; file: string | null; importers: Set<FakeModule>; isSelfAccepting?: boolean};

const mod = (
  label: string,
  file: string | null,
  importers: FakeModule[] = [],
  isSelfAccepting = false,
): FakeModule => ({
  label,
  file: file && normalizePath(file),
  importers: new Set(importers),
  isSelfAccepting,
});

/** transform で pageFile を markdocFiles に登録したプラグインと、偽のモジュールグラフで hotUpdate を呼ぶ関数。 */
async function setup(options: MarkdocVitePluginOptions) {
  const plugin = markdoc({dir: fx, ...options});
  callConfigResolved(plugin, {root: fx, command: 'serve'});
  await callTransform(plugin, fakePluginContext(), fs.readFileSync(pageFile, 'utf8'), pageFile);
  const page = mod('page', pageFile);
  const component = mod('component', pageFile);
  const sent: unknown[] = [];
  const invalidated: FakeModule[] = [];
  const ctx = {
    environment: {
      moduleGraph: {
        getModulesByFile: (file: string) => (file === page.file ? new Set([page, component]) : undefined),
        invalidateModule: (m: FakeModule) => invalidated.push(m),
      },
      hot: {send: (payload: unknown) => sent.push(payload)},
    },
  };
  const hook = plugin.hotUpdate as (this: unknown, o: {type: string; file: string; modules: unknown[]}) => unknown;
  const call = (type: string, file: string, modules: FakeModule[] = []) => hook.call(ctx, {type, file, modules});
  const labels = (res: unknown) => (res as FakeModule[]).map((m) => m.label).sort();
  return {call, labels, sent, invalidated, page, component};
}

describe('hotUpdate without fastRefresh', () => {
  for (const [label, type, file] of [
    ['partial edit', 'update', partialFile],
    ['schema file edit', 'update', tagsFile],
    ['new page outside the schema dir', 'create', path.join(fx, 'pages/new.md')],
  ] as const) {
    test(`${label} → default propagation, nothing sent or invalidated`, async () => {
      const s = await setup({});
      expect(s.call(type, file, [mod('edited', file, [s.page])])).toBeUndefined();
      expect(s.sent).toEqual([]);
      expect(s.invalidated).toEqual([]);
    });
  }

  for (const [label, type, file] of [
    ['schema entry created', 'create', path.join(fx, 'markdoc/config.ts')],
    ['partial deleted', 'delete', partialFile],
  ] as const) {
    test(`${label} → invalidates the Markdoc modules, full-reload, returns []`, async () => {
      const s = await setup({});
      expect(s.call(type, file)).toEqual([]);
      expect(s.sent).toEqual([{type: 'full-reload'}]);
      expect(s.labels(s.invalidated)).toEqual(['component', 'page']);
    });
  }

  test('schema dir create also invalidates the passed modules (resolve-failed error modules)', async () => {
    const s = await setup({});
    const file = path.join(fx, 'markdoc/nodes.ts');
    expect(s.call('create', file, [mod('failed', file)])).toEqual([]);
    expect(s.labels(s.invalidated)).toEqual(['component', 'failed', 'page']);
  });
});

describe('hotUpdate with fastRefresh: walk over importers', () => {
  test('a partial imported by the page adds every module of the page', async () => {
    const s = await setup({fastRefresh: true});
    const partial = mod('partial', partialFile, [s.page]);
    expect(s.labels(s.call('update', partialFile, [partial]))).toEqual(['component', 'page', 'partial']);
    expect(s.sent).toEqual([]);
  });

  test('a transitive dependency (dep → schema → page) adds the page modules', async () => {
    const s = await setup({fastRefresh: true});
    const schema = mod('schema', tagsFile, [s.page]);
    const dep = mod('dep', path.join(fx, 'components/dep.ts'), [schema]);
    expect(s.labels(s.call('update', dep.file ?? '', [dep]))).toEqual(['component', 'dep', 'page']);
  });

  test('a file not imported by a Markdoc page → default propagation', async () => {
    const s = await setup({fastRefresh: true});
    const other = mod('other', path.join(fx, 'components/other.ts'));
    expect(s.call('update', other.file ?? '', [other])).toBeUndefined();
  });

  test('the walk stops at a self-accepting importer', async () => {
    const s = await setup({fastRefresh: true});
    const boundary = mod('boundary', path.join(fx, 'components/boundary.tsx'), [s.page], true);
    const dep = mod('dep', path.join(fx, 'components/dep.ts'), [boundary]);
    expect(s.call('update', dep.file ?? '', [dep])).toBeUndefined();
  });

  test('an import cycle without a Markdoc page terminates with default propagation', async () => {
    const s = await setup({fastRefresh: true});
    const a = mod('a', path.join(fx, 'components/a.ts'));
    const b = mod('b', path.join(fx, 'components/b.ts'), [a]);
    a.importers.add(b);
    expect(s.call('update', a.file ?? '', [a])).toBeUndefined();
  });

  test('an import cycle that reaches a Markdoc page adds the page modules once', async () => {
    const s = await setup({fastRefresh: true});
    const a = mod('a', path.join(fx, 'components/a.ts'), [s.page]);
    const b = mod('b', path.join(fx, 'components/b.ts'), [a]);
    a.importers.add(b);
    expect(s.labels(s.call('update', b.file ?? '', [b]))).toEqual(['b', 'component', 'page']);
  });
});
