import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {normalizePath, type ViteDevServer} from 'vite';
import {COMPONENT_QUERY} from '../../src/module-ids';
import {markdoc} from '../../src/vite/plugin';
import {
  clientUpdatePaths,
  closeServer,
  type HotPayload,
  recordHotPayloads,
  startDevServer,
} from '../helpers/dev-server';
import {writeFile, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {type PageModule, renderModule} from '../helpers/render';
import {waitFor} from '../helpers/vite';

const dir = tmpDirFor(import.meta);
const fx = path.join(dir, 'build-fr');

let server: ViteDevServer;
let payloads: HotPayload[] = [];
const client = () => server.environments.client;
const bothFrModules = (paths: string[]) =>
  paths.includes('/pages/fr.md') && paths.includes(`/pages/fr.md?${COMPONENT_QUERY}`);
const MODULE_URLS = [
  '/pages/fr.md',
  `/pages/fr.md?${COMPONENT_QUERY}`,
  '/components/note.md',
  `/components/note.md?${COMPONENT_QUERY}`,
];

/** モジュールをグラフに載せてから、記録済みの payload を捨てる。 */
async function primeModules(): Promise<void> {
  for (const url of MODULE_URLS) await client().transformRequest(url);
  payloads.length = 0;
}

beforeAll(async () => {
  writeTree(fx, {
    'markdoc/tags.ts': 'export default {};\n',
    'markdoc/partials/foot.md': 'FOOT-INITIAL\n',
    'pages/fr.md': '# FR-INITIAL\n\n{% partial file="foot.md" /%}\n',
    'components/note.md': '# NOTE-INITIAL\n',
  });
  server = await startDevServer(fx, markdoc({fastRefresh: true, compile: 'build'}), {ws: false});
  payloads = recordHotPayloads(server);
}, 60000);

afterAll(async () => {
  await closeServer(server);
});

describe("dev server, fastRefresh + compile: 'build': module graph", () => {
  test('client code has no raw source; the ssr module has a map pointing at the .md', async () => {
    const code = (await client().transformRequest('/pages/fr.md'))?.code ?? '';
    expect(code).not.toContain('# FR-INITIAL');
    expect(code).not.toContain('{% partial');
    const map = (await server.environments.ssr.transformRequest('/pages/fr.md'))?.map as {sources?: string[]} | null;
    expect(map?.sources?.filter((src) => src.endsWith('fr.md'))).toHaveLength(1);
  });

  test('page and component modules share the .md file and are both self-accepting', async () => {
    await primeModules();
    const mods = [...(client().moduleGraph.getModulesByFile(normalizePath(path.join(fx, 'pages/fr.md'))) ?? [])];
    expect(mods.map((m) => m.url).sort()).toEqual(['/pages/fr.md', `/pages/fr.md?${COMPONENT_QUERY}`]);
    expect(mods.map((m) => m.isSelfAccepting)).toEqual([true, true]);
  });

  test('SSR: the circular page/component import renders', async () => {
    const ssr = (await server.ssrLoadModule('/components/note.md')) as unknown as PageModule;
    expect(await renderModule(ssr)).toContain('NOTE-INITIAL');
  });
});

describe("dev server, fastRefresh + compile: 'build': HMR payloads", () => {
  test('editing a component .md sends an update covering its component module', async () => {
    await primeModules();
    fs.writeFileSync(path.join(fx, 'components/note.md'), '# NOTE-UPDATED\n');
    await waitFor('note update payload', async () =>
      clientUpdatePaths(payloads).includes(`/components/note.md?${COMPONENT_QUERY}`),
    );
  });

  test('editing a partial updates the page and its ?markdoc-component module with the new content', async () => {
    await primeModules();
    fs.writeFileSync(path.join(fx, 'markdoc/partials/foot.md'), 'FOOT-UPDATED\n');
    await waitFor('partial update payload', async () => bothFrModules(clientUpdatePaths(payloads)));
    expect((await client().transformRequest('/pages/fr.md'))?.code ?? '').toContain('FOOT-UPDATED');
  });

  test('editing the schema module updates the page and its ?markdoc-component module', async () => {
    await primeModules();
    fs.writeFileSync(path.join(fx, 'markdoc/tags.ts'), 'export default {}; // updated\n');
    await waitFor('tags update payload', async () => bothFrModules(clientUpdatePaths(payloads)));
  });

  test('creating markdoc/config.ts sends a full-reload to the client and ssr environments', async () => {
    await primeModules();
    writeFile(path.join(fx, 'markdoc/config.ts'), "export default {variables: {product: 'Acme'}};\n");
    const reloaded = (env: string) => payloads.some((p) => p.env === env && p.payload.type === 'full-reload');
    await waitFor('full-reload in client and ssr', async () => reloaded('client') && reloaded('ssr'));
  });
});

describe("dev server, fastRefresh + compile: 'runtime'", () => {
  let runtimeServer: ViteDevServer | undefined;
  afterAll(async () => {
    await closeServer(runtimeServer);
  });

  test('editing a file imported by a schema module updates both Markdoc modules', async () => {
    const root = path.join(dir, 'runtime-fr');
    writeTree(root, {
      'app/page.md': '{% $v %}\n',
      'src/consts.ts': "export const V = 'AAA';\n",
      'markdoc/config.ts': "import {V} from '../src/consts';\nexport default {variables: {v: V}};\n",
    });
    runtimeServer = await startDevServer(root, markdoc({fastRefresh: true}));
    const recorded = recordHotPayloads(runtimeServer);
    for (const url of ['/app/page.md', `/app/page.md?${COMPONENT_QUERY}`, '/markdoc/config.ts', '/src/consts.ts']) {
      await runtimeServer.environments.client.transformRequest(url);
    }
    fs.writeFileSync(path.join(root, 'src/consts.ts'), "export const V = 'BBB';\n");
    await waitFor('update payload for the Markdoc modules', async () => {
      const paths = clientUpdatePaths(recorded);
      return paths.includes('/app/page.md') && paths.includes(`/app/page.md?${COMPONENT_QUERY}`);
    });
  });
});
