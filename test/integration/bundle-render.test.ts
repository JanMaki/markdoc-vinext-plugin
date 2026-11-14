import {beforeAll, describe, expect, test} from 'bun:test';
import {appSample, componentSample, pagesSample, tmpDirFor} from '../helpers/paths';
import {type MarkdocDataProps, type PageModule, renderModule} from '../helpers/render';
import {bundleEntry, importBundle} from '../helpers/vite';

const dir = tmpDirFor(import.meta);

let pagesMod: PageModule;
let serverMod: PageModule;
let appMod: PageModule;
let noteMod: PageModule;
let staticMarkdoc: MarkdocDataProps['markdoc'];
let pagesHtml = '';
let serverHtml = '';
let appHtml = '';
let noteHtml = '';

/** `html` に含まれない `needles`。 */
const missing = (html: string, needles: string[]): string[] => needles.filter((n) => !html.includes(n));

beforeAll(async () => {
  const bundle = async (entry: string, name: string, options: object) =>
    (await importBundle(await bundleEntry(entry, dir, name, {schemaPath: './markdoc', ...options}))) as PageModule;
  pagesMod = await bundle(pagesSample, 'pages-static.js', {mode: 'static', router: 'auto'});
  serverMod = await bundle(pagesSample, 'pages-server.js', {mode: 'server', router: 'pages'});
  appMod = await bundle(appSample, 'app-page.js', {router: 'auto'});
  noteMod = await bundle(componentSample, 'component-note.js', {router: 'auto'});

  const staticProps = await pagesMod.getStaticProps?.({});
  staticMarkdoc = staticProps?.props.markdoc;
  pagesHtml = await renderModule(pagesMod, staticProps?.props);
  serverHtml = await renderModule(serverMod, (await serverMod.getServerSideProps?.({}))?.props);
  appHtml = await renderModule(appMod);
  noteHtml = await renderModule(noteMod);
}, 120000);

describe('Vite library build + react-dom/server render: Pages Router', () => {
  test('mode static exports default, getStaticProps and markdoc, and no getServerSideProps', () => {
    expect(typeof pagesMod.default).toBe('function');
    expect(typeof pagesMod.getStaticProps).toBe('function');
    expect(pagesMod.getServerSideProps).toBeUndefined();
    expect(pagesMod.markdoc.frontmatter.title).toBe('Get started with Markdoc');
  });

  test('getStaticProps returns the renderable tree, frontmatter and file path', () => {
    expect(staticMarkdoc).toMatchObject({
      content: {$$mdtype: 'Tag', name: 'article'},
      frontmatter: {title: 'Get started with Markdoc'},
      file: {path: '/docs/getting-started.md'},
    });
  });

  test('HTML has the heading, custom tags, function, config variable and partial', () => {
    expect(
      missing(pagesHtml, [
        'Get started with Markdoc',
        'data-callout="info"',
        'custom',
        'data-markdoc-tag="tag"',
        'HELLO',
        'Vinext',
        'Footer partial',
      ]),
    ).toEqual([]);
  });

  test('mode server exports getServerSideProps only and renders', () => {
    expect(typeof serverMod.getServerSideProps).toBe('function');
    expect(serverMod.getStaticProps).toBeUndefined();
    expect(missing(serverHtml, ['data-callout="info"', 'HELLO'])).toEqual([]);
  });
});

describe('Vite library build + react-dom/server render: App Router and component', () => {
  test('App page: async default export, metadata and revalidate from frontmatter.nextjs', () => {
    expect(appMod.default({})).toBeInstanceOf(Promise);
    expect(appMod.metadata).toMatchObject({title: 'App Router Markdoc page'});
    expect(appMod.revalidate).toBe(60);
  });

  test('App page HTML has the heading, custom tags, function, config variable and partial', () => {
    expect(
      missing(appHtml, [
        'App Router Markdoc page',
        'data-callout="info"',
        'data-markdoc-tag="tag"',
        'HELLO',
        'Vinext',
        'Footer partial',
      ]),
    ).toEqual([]);
  });

  test('component: sync default export, no data fetching, renders', () => {
    expect(noteMod.default({})).not.toBeInstanceOf(Promise);
    expect(noteMod.getStaticProps).toBeUndefined();
    expect(missing(noteHtml, ['data-callout="warn"', 'Imported Markdoc component'])).toEqual([]);
  });
});
