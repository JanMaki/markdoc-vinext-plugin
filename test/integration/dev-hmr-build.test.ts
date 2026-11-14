import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type {ViteDevServer} from 'vite';
import {markdoc} from '../../src/vite/plugin';
import {closeServer, startDevServer} from '../helpers/dev-server';
import {writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {waitFor} from '../helpers/vite';

const fx = tmpDirFor(import.meta);
const tagsFile = path.join(fx, 'markdoc/tags.ts');
const defFile = path.join(fx, 'components/def.ts');

/** components/def.ts を import するスキーマ。callout の属性の既定値に埋め込む。 */
const tagsSource = (tagDefault: string) =>
  `import def from '../components/def';\nexport default {callout: {render: 'aside', attributes: {type: {type: String, default: '${tagDefault}'}, dep: {type: String, default: def}}}};\n`;

let server: ViteDevServer;
const codeOf = async (url: string): Promise<string> =>
  (await server.environments.client.transformRequest(url))?.code ?? '';
const bothInclude = async (needle: string): Promise<boolean> =>
  (await codeOf('/pages/a.md')).includes(needle) && (await codeOf('/pages/b.md')).includes(needle);

beforeAll(async () => {
  writeTree(fx, {
    'markdoc/tags.ts': tagsSource('TAG-INITIAL'),
    'components/def.ts': "export default 'DEP-INITIAL';\n",
    'pages/a.md': '{% callout %}A{% /callout %}\n',
    'pages/b.md': '{% callout %}B{% /callout %}\n',
  });
  server = await startDevServer(fx, markdoc({compile: 'build'}), {hmr: false});
}, 60000);

afterAll(async () => {
  await closeServer(server);
});

describe("dev server, compile: 'build': schema module and dependency edits", () => {
  test('edits to the schema and to its dependency re-transform both pages; a failed import is not cached', async () => {
    expect(await bothInclude('TAG-INITIAL')).toBe(true);
    expect(await bothInclude('DEP-INITIAL')).toBe(true);

    fs.writeFileSync(tagsFile, tagsSource('TAG-UPDATED'));
    await waitFor('tags edit', () => bothInclude('TAG-UPDATED'));

    fs.writeFileSync(defFile, "export default 'DEP-UPDATED';\n");
    await waitFor('dependency edit', () => bothInclude('DEP-UPDATED'));

    fs.writeFileSync(defFile, "export default 'DEP-BROKEN\n");
    await waitFor('dependency syntax error', async () => {
      try {
        await codeOf('/pages/a.md');
        return false;
      } catch {
        return true;
      }
    });

    fs.writeFileSync(defFile, "export default 'DEP-FIXED';\n");
    await waitFor('dependency fix', () => bothInclude('DEP-FIXED'));
  });
});
