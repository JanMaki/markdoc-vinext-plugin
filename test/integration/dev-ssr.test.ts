import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {normalizePath, type ViteDevServer} from 'vite';
import type {MarkdocVitePluginOptions} from '../../src/types';
import {markdoc} from '../../src/vite/plugin';
import {closeServer, startDevServer} from '../helpers/dev-server';
import {trySymlink, writeFile, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {type PageModule, renderModule} from '../helpers/render';
import {waitFor} from '../helpers/vite';

const dir = tmpDirFor(import.meta);
const fx = path.join(dir, 'site');
const partials = path.join(fx, 'markdoc/partials');
const configFile = path.join(fx, 'markdoc/config.ts');

let server: ViteDevServer;
/** 他のテストで起動した dev サーバ。afterAll で閉じる。 */
const extraServers: ViteDevServer[] = [];

/** SSR で読み込んで描画する。React がテキストの区切りに入れる `<!-- -->` は除く。 */
async function renderDevPage(url: string): Promise<{html: string; mod: PageModule}> {
  const mod = (await server.ssrLoadModule(url)) as unknown as PageModule;
  const props = mod.getStaticProps ? (await mod.getStaticProps({})).props : {};
  return {html: (await renderModule(mod, props)).replaceAll('<!-- -->', ''), mod};
}

beforeAll(async () => {
  writeTree(fx, {
    // スキーマのエントリと同名の偽パッケージ。
    'node_modules/config/package.json': '{"name":"config","main":"index.js"}',
    'node_modules/config/index.js': 'export default {variables: {product: "WRONG-PACKAGE-CONFIG"}};\n',
    'markdoc/tags.ts': 'export default {};\n',
    'markdoc/partials/footer.md': 'Footer initial\n',
    'pages/bom.md': '﻿---\r\ntitle: Bom Title\r\n---\r\n\r\n# Heading {% $markdoc.frontmatter.title %}\r\n',
    'pages/plain.md': '# Plain heading\n',
    'pages/empty.md': '',
    'pages/scalar.md': '---\nhello\n---\n# Scalar\n',
    'app/nullfm/page.md': '---\n~\n---\n# Null frontmatter\n',
    'pages/product.md': 'Product: [{% $product %}]\n',
    'pages/hmr.md': '{% partial file="footer.md" /%}\n\nProduct: [{% $product %}]\n',
    'pages/missing.md': '{% partial file="later.md" /%}\n',
  });
  server = await startDevServer(fx, markdoc(), {hmr: false});
}, 60000);

afterAll(async () => {
  await closeServer(server);
  for (const s of extraServers) await closeServer(s);
});

describe('Vite dev server: SSR load', () => {
  test('BOM + CRLF frontmatter is parsed and rendered', async () => {
    const {mod, html} = await renderDevPage('/pages/bom.md');
    expect(mod.markdoc.frontmatter.title).toBe('Bom Title');
    expect(html).toContain('Heading Bom Title');
  });

  for (const [label, url, text] of [
    ['no frontmatter', '/pages/plain.md', 'Plain heading'],
    ['an empty file', '/pages/empty.md', '<article></article>'],
    ['scalar frontmatter', '/pages/scalar.md', 'Scalar'],
  ] as const) {
    test(`${label} → frontmatter {}, renders`, async () => {
      const {mod, html} = await renderDevPage(url);
      expect(mod.markdoc.frontmatter).toEqual({});
      expect(html).toContain(text);
    });
  }

  test('null frontmatter App page loads with metadata undefined and renders', async () => {
    const {mod, html} = await renderDevPage('/app/nullfm/page.md');
    expect(mod.metadata).toBeUndefined();
    expect(html).toContain('Null frontmatter');
  });

  test('the node_modules package "config" is not used as the schema config (real Vite resolve)', async () => {
    expect((await renderDevPage('/pages/product.md')).html).toContain('Product: []');
  });
});

// hmr: false でも watcher による再変換で反映される。
describe('Vite dev server: watcher re-transform without HMR', () => {
  test('partial edit, config creation and config deletion are picked up', async () => {
    const html = async () => (await renderDevPage('/pages/hmr.md')).html;
    expect(await html()).toContain('Footer initial');

    fs.writeFileSync(path.join(partials, 'footer.md'), 'Footer updated\n');
    await waitFor('partial change', async () => (await html()).includes('Footer updated'));

    writeFile(configFile, "export default {variables: {product: 'Acme'}};\n");
    await waitFor('config add', async () => (await html()).includes('Product: [Acme]'));

    fs.rmSync(configFile);
    await waitFor('config unlink', async () => (await html()).includes('Product: []'));
  });

  test('a missing partial fails the module naming later.md; creating it recovers without restart', async () => {
    await expect(server.ssrLoadModule('/pages/missing.md')).rejects.toThrow('later.md');
    writeFile(path.join(partials, 'later.md'), 'Later partial arrived\n');
    await waitFor('partial add', async () =>
      (await renderDevPage('/pages/missing.md')).html.includes('Later partial arrived'),
    );
  });
});

describe("dev server, compile: 'build': frontmatter Dates", () => {
  test('a `$markdocDate` user key stays a plain object while real Dates are restored', async () => {
    const root = path.join(dir, 'dates');
    writeTree(root, {
      'app/page.md':
        '---\nd: 2020-01-02\nds: [2020-01-03]\nfake: {"$markdocDate": "1999-01-01T00:00:00.000Z"}\n---\nhi\n',
    });
    const s = await startDevServer(root, markdoc({compile: 'build'}), {hmr: false});
    extraServers.push(s);
    const fm = ((await s.ssrLoadModule('/app/page.md')) as unknown as PageModule).markdoc.frontmatter;
    expect(fm.d).toEqual(new Date('2020-01-02T00:00:00.000Z'));
    expect((fm.ds as unknown[])[0]).toBeInstanceOf(Date);
    expect(fm.fake).toEqual({$markdocDate: '1999-01-01T00:00:00.000Z'});
  });
});

// real/proj を alt/link から参照する。alt/link/../shared は alt/shared、実パスの親は real/shared。
describe('linked (symlink / junction) project root', () => {
  const realProj = path.join(dir, 'real', 'proj');
  const link = path.join(dir, 'alt', 'link');
  // skipIf の判定に使うため、収集時に作成する。
  writeTree(dir, {
    'real/proj/app/page.md': '{% $v %}\n',
    'real/proj/markdoc/config.ts': "export default {variables: {v: 'FROM_DEFAULT'}};\n",
    'real/shared/config.ts': "export default {variables: {v: 'FROM_REAL_PARENT'}};\n",
    'alt/shared/config.ts': "export default {variables: {v: 'FROM_LINK_PARENT'}};\n",
  });
  const linked = trySymlink(realProj, link, 'junction');

  const linkedServer = async (options: MarkdocVitePluginOptions, preserveSymlinks: boolean) => {
    const s = await startDevServer(link, markdoc(options), {hmr: false}, {resolve: {preserveSymlinks}});
    extraServers.push(s);
    return s;
  };

  test.skipIf(!linked)("schemaPath '../shared' uses the directory added to server.fs.allow", async () => {
    const s = await linkedServer({compile: 'build', schemaPath: '../shared'}, false);
    expect(s.config.server.fs.allow).toContain(normalizePath(path.join(dir, 'alt', 'shared')));
    const code = (await s.environments.ssr.transformRequest('/app/page.md'))?.code ?? '';
    expect(code).toContain('FROM_LINK_PARENT');
    expect(code).not.toContain('FROM_REAL_PARENT');
  });

  for (const preserveSymlinks of [false, true]) {
    test.skipIf(!linked)(`pages are detected with resolve.preserveSymlinks: ${preserveSymlinks}`, async () => {
      const s = await linkedServer({compile: 'build'}, preserveSymlinks);
      const mod = (await s.ssrLoadModule('/app/page.md')) as unknown as PageModule;
      expect(mod.default({})).toBeInstanceOf(Promise);
      expect(await renderModule(mod)).toContain('FROM_DEFAULT');
    });
  }
});
