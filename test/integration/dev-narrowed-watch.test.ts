import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type {Plugin, ViteDevServer} from 'vite';
import {isInside} from '../../src/paths';
import {markdoc} from '../../src/vite/plugin';
import {errorMessage, sleep} from '../helpers/code';
import {closeServer, type HotPayload, recordHotPayloads, startDevServer} from '../helpers/dev-server';
import {DEBOUNCE_SETTLED_MS} from '../helpers/fake-dev-server';
import {writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {waitFor} from '../helpers/vite';

const dir = tmpDirFor(import.meta);
/** schemaPath '..' でスキーマフォルダになる、ルートを含むフォルダ。 */
const ws = path.join(dir, 'ws');
const root = path.join(ws, 'proj');
const sibling = path.join(ws, 'sibling');
const tags = path.join(ws, 'tags.ts');

let server: ViteDevServer;
let payloads: HotPayload[] = [];
/** server.watcher.add に渡されたパス。 */
const added: string[] = [];
/** hotUpdate に届いたイベント (`<type> <ファイル>`)。 */
const hotEvents: string[] = [];

/** hotUpdate のイベントを記録するプラグイン。 */
const recorder: Plugin = {
  name: 'record-hot-update',
  hotUpdate({type, file}) {
    hotEvents.push(`${type} ${path.resolve(file)}`);
  },
};

beforeAll(async () => {
  writeTree(ws, {
    'tags.ts': "throw new Error('SCHEMA-BROKEN');\n",
    'partials/p.md': 'P\n',
    'sibling/x.ts': 'export {};\n',
    'proj/pages/a.md': '# A\n',
  });
  server = await startDevServer(
    root,
    markdoc({schemaPath: '..', compile: 'build'}),
    {ws: false},
    {
      plugins: [recorder],
    },
  );
  payloads = recordHotPayloads(server);
  const add = server.watcher.add.bind(server.watcher);
  server.watcher.add = ((paths: string | readonly string[]) => {
    added.push(...[paths].flat());
    return add(paths);
  }) as typeof server.watcher.add;
}, 60000);

afterAll(async () => {
  await closeServer(server);
});

const client = () => server.environments.client;

/** chokidar が監視しているディレクトリ。 */
const watchedDirs = () => Object.keys(server.watcher.getWatched()).map((d) => path.resolve(d));

describe('dev server, schema dir containing the root', () => {
  test('a failed schema import does not watch the schema dir or its sibling folders', async () => {
    const error = await client()
      .transformRequest('/pages/a.md')
      .catch((e: unknown) => e);
    expect(errorMessage(error)).toContain('SCHEMA-BROKEN');
    expect(added.map((p) => path.resolve(p))).toContain(tags);
    expect(added.filter((p) => isInside(path.resolve(p), sibling))).toEqual([]);
    await waitFor('tags.ts watched', async () => server.watcher.getWatched()[ws]?.includes('tags.ts') ?? false);
    expect(watchedDirs().filter((d) => isInside(sibling, d))).toEqual([]);
  });

  test('an added project file neither invalidates the Markdoc page nor sends a full-reload', async () => {
    fs.writeFileSync(tags, 'export default {};\n');
    // tags.ts の変更の処理 (ページの無効化) が終わってから変換する。
    await waitFor('update event for tags.ts', async () => hotEvents.includes(`update ${tags}`));
    await waitFor('page transforms', async () => !!(await client().transformRequest('/pages/a.md')));
    const page = await client().moduleGraph.getModuleByUrl('/pages/a.md');
    expect(page?.transformResult).toBeTruthy();
    payloads.length = 0;
    const other = path.join(root, 'other.ts');
    fs.writeFileSync(other, 'export {};\n');
    await waitFor('create event for other.ts', async () => hotEvents.includes(`create ${other}`));
    await sleep(DEBOUNCE_SETTLED_MS);
    expect(page?.transformResult).toBeTruthy();
    expect(payloads.filter((p) => p.payload.type === 'full-reload')).toEqual([]);
  });
});
