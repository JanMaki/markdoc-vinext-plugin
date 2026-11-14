import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import Markdoc from '@markdoc/markdoc';
import {createElement, Fragment} from 'react';
import {renderToString} from 'react-dom/server';
import {containsMarker, errorMessage} from '../helpers/code';
import {writeFile} from '../helpers/fixtures';
import {appSample, componentSample, exampleRoot, pagesSample, tmpDirFor} from '../helpers/paths';
import {type MarkdocDataProps, type PageModule, renderModule} from '../helpers/render';
import {RAW_MARKERS} from '../helpers/transform';
import {importBundle, measureBuild} from '../helpers/vite';

const dir = tmpDirFor(import.meta);

/** `$$mdtype` で Tag を偽装する frontmatter。sanitizeFrontmatter がなければ img の onerror が HTML に出る。 */
const XSS_FRONTMATTER = `x:
  $$mdtype: Tag
  name: div
  attributes:
    dangerouslySetInnerHTML:
      __html: '<img src=x onerror=alert(1)>'
  children: []`;

/** renderable tree に `attributes.dangerouslySetInnerHTML` を持つ Tag があれば true。 */
function hasInjectedTag(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasInjectedTag);
  if (!node || typeof node !== 'object') return false;
  const tag = node as {$$mdtype?: unknown; attributes?: Record<string, unknown>; children?: unknown[]};
  if (tag.$$mdtype === 'Tag' && tag.attributes && 'dangerouslySetInnerHTML' in tag.attributes) return true;
  return hasInjectedTag(tag.children ?? []);
}

/** 描画結果。例外は HTML の代わりに `<render error: …>` として返す。 */
async function safeRender(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (error) {
    return `<render error: ${errorMessage(error)}>`;
  }
}

/** `html` に含まれない `needles`。 */
const missing = (html: string, needles: string[]): string[] => needles.filter((n) => !html.includes(n));
const PAGE_NEEDLES = ['data-callout="info"', 'data-markdoc-tag="tag"', 'HELLO', 'Vinext', 'Footer partial'];

describe("compile: 'build' bundles render; sizes", () => {
  const out = {runtimeClient: '', buildClient: '', appBuildClient: '', appBuildServer: '', serverMode: ''};
  const sizeOf = (file: string): number => fs.statSync(file).size;
  let sizes = {runtimePagesClientMin: 0, buildPagesClientMin: 0, buildAppClientMin: 0, buildAppServerMin: 0};

  beforeAll(async () => {
    out.runtimeClient = await measureBuild(pagesSample, dir, 'pages-runtime-client.min.js', {});
    out.buildClient = await measureBuild(pagesSample, dir, 'pages-build-client.min.js', {compile: 'build'});
    out.appBuildClient = await measureBuild(appSample, dir, 'app-build-client.min.js', {compile: 'build'});
    out.appBuildServer = await measureBuild(appSample, dir, 'app-build-server.min.js', {compile: 'build'}, {ssr: true});
    out.serverMode = await measureBuild(
      pagesSample,
      dir,
      'pages-build-servermode-ssr.js',
      {compile: 'build', mode: 'server', router: 'pages'},
      {ssr: true, minify: false},
    );
    sizes = {
      runtimePagesClientMin: sizeOf(out.runtimeClient),
      buildPagesClientMin: sizeOf(out.buildClient),
      buildAppClientMin: sizeOf(out.appBuildClient),
      buildAppServerMin: sizeOf(out.appBuildServer),
    };
    if (process.env.MARKDOC_PRINT_SIZES === '1') console.log(`  sizes (bytes): ${JSON.stringify(sizes)}`);
    fs.writeFileSync(path.join(dir, 'sizes.json'), JSON.stringify(sizes, null, 2));
  }, 120000);

  test("the compile: 'build' Pages client is < 5% of the runtime client and < 20 KB; the App client < 20 KB", () => {
    expect(sizes.buildPagesClientMin).toBeLessThan(sizes.runtimePagesClientMin * 0.05);
    expect(sizes.buildPagesClientMin).toBeLessThan(20_000);
    expect(sizes.buildAppClientMin).toBeLessThan(20_000);
  });

  test('the minified build client has no Tokenizer / js-yaml / markdown-it / raw source; the runtime client has all', () => {
    const code = fs.readFileSync(out.buildClient, 'utf8');
    const leaks = [
      code.includes('Tokenizer') && 'Tokenizer',
      /FAILSAFE_SCHEMA|YAMLException/.test(code) && 'js-yaml',
      /markdown-it|linkify/i.test(code) && 'markdown-it',
      ...RAW_MARKERS.filter((m) => containsMarker(code, m)),
    ].filter(Boolean);
    expect(leaks).toEqual([]);
    const runtime = fs.readFileSync(out.runtimeClient, 'utf8');
    expect(runtime).toContain('Tokenizer');
    expect(RAW_MARKERS.filter((m) => !containsMarker(runtime, m))).toEqual([]);
  });

  test('build client and runtime client getStaticProps return the same data and HTML', async () => {
    const [build, runtime] = await Promise.all(
      [out.buildClient, out.runtimeClient].map(async (file) => (await importBundle(file)) as PageModule),
    );
    const buildProps = (await build?.getStaticProps?.({}))?.props;
    const runtimeProps = (await runtime?.getStaticProps?.({}))?.props;
    expect(buildProps).toEqual(runtimeProps as MarkdocDataProps);
    expect(buildProps?.markdoc?.file?.path).toBe('/docs/getting-started.md');
    expect(build?.markdoc.frontmatter.title).toBe('Get started with Markdoc');
    const html = await renderModule(build as PageModule, buildProps);
    expect(missing(html, [...PAGE_NEEDLES, 'Get started with Markdoc'])).toEqual([]);
    expect(html).toBe(await renderModule(runtime as PageModule, runtimeProps));
  });

  test('build App server: metadata, revalidate and HTML', async () => {
    const appMod = (await importBundle(out.appBuildServer)) as PageModule;
    expect(appMod.metadata).toMatchObject({title: 'App Router Markdoc page'});
    expect(appMod.revalidate).toBe(60);
    expect(missing(await renderModule(appMod), PAGE_NEEDLES)).toEqual([]);
  });

  test('fastRefresh production build: the circular page/component bundle renders', async () => {
    const frBuild = await measureBuild(componentSample, dir, 'fastrefresh-client.min.js', {
      fastRefresh: true,
      compile: 'build',
    });
    expect(await renderModule((await importBundle(frBuild)) as PageModule)).toContain('data-callout="warn"');
  });

  test('build + mode server: context.variables reach the server transform', async () => {
    const ssm = (await importBundle(out.serverMode)) as PageModule;
    const props = await ssm.getServerSideProps?.({variables: {product: 'FromRequestVariables'}});
    expect(await renderModule(ssm, props?.props)).toContain('FromRequestVariables');
  });
});

describe("frontmatter Dates and $$mdtype: compile 'runtime' vs 'build' bundles", () => {
  const page = path.join(dir, 'fx-frontmatter/pages/fm.md');
  const pagesDir = path.relative(exampleRoot, path.dirname(page));
  const modes = ['runtime', 'build client', 'build server'] as const;
  const results = {} as Record<(typeof modes)[number], {mod: PageModule; props?: MarkdocDataProps; html: string}>;

  beforeAll(async () => {
    writeFile(
      page,
      `---\ntitle: Dated\ndate: 2024-01-02\nnested:\n  when: 2024-01-03\n${XSS_FRONTMATTER}\n---\n\n# {% $markdoc.frontmatter.title %}\n\n{% $markdoc.frontmatter.x %}\n`,
    );
    const bundles = {
      runtime: await measureBuild(page, dir, 'fm-runtime.js', {pagesDir}, {minify: false}),
      'build client': await measureBuild(
        page,
        dir,
        'fm-build-client.js',
        {pagesDir, compile: 'build'},
        {minify: false},
      ),
      'build server': await measureBuild(
        page,
        dir,
        'fm-build-server.js',
        {pagesDir, compile: 'build'},
        {ssr: true, minify: false},
      ),
    };
    for (const mode of modes) {
      const mod = (await importBundle(bundles[mode])) as PageModule;
      const props = (await mod.getStaticProps?.({}))?.props;
      results[mode] = {mod, props, html: await safeRender(() => renderModule(mod, props ?? {}))};
    }
  }, 120000);

  for (const mode of modes) {
    test(`${mode}: exported markdoc.frontmatter keeps YAML dates as Date and has no $$mdtype`, () => {
      const fm = results[mode].mod.markdoc.frontmatter as {date?: unknown; nested?: {when?: unknown}};
      expect(fm.date).toEqual(new Date('2024-01-02T00:00:00.000Z'));
      expect(fm.nested?.when).toBeInstanceOf(Date);
      expect(JSON.stringify(fm)).not.toContain('$$mdtype');
    });

    test(`${mode}: getMarkdocData() has the title, the date as a JSON string, and x as plain data, not a Tag`, () => {
      const markdoc = results[mode].props?.markdoc;
      expect(markdoc?.frontmatter?.date).toBe('2024-01-02T00:00:00.000Z');
      const content = JSON.stringify(markdoc?.content);
      expect(content).toContain('"children":["Dated"]');
      // x は $$mdtype を除いたオブジェクトとして本文に入る。
      expect(content).toContain('{"name":"div","attributes":{"dangerouslySetInnerHTML"');
      expect(hasInjectedTag(markdoc?.content)).toBe(false);
    });

    // $$mdtype を除いた x は Tag ではないため、React はオブジェクトの子として描画を拒否する (error #31)。
    test(`${mode}: rendering does not emit the injected onerror; React rejects x as an object child`, () => {
      const {html} = results[mode];
      expect(html).toStartWith('<render error: ');
      expect(html).toMatch(/error #31|Objects are not valid as a React child/);
      expect(html).not.toContain('onerror');
    });
  }

  test("getMarkdocData() output is identical in compile 'runtime' and 'build'", () => {
    const data = modes.map((mode) => JSON.stringify(results[mode].props?.markdoc));
    expect(new Set(data).size).toBe(1);
  });

  // sanitizeFrontmatter がない場合に onerror が出力されることを確認する (フィクスチャの有効性)。
  test('XSS fixture injects onerror without sanitizing (positive control)', async () => {
    const {load} = await import('js-yaml');
    const unsafe = Markdoc.transform(Markdoc.parse('{% $markdoc.frontmatter.x %}\n'), {
      variables: {markdoc: {frontmatter: load(XSS_FRONTMATTER) as Record<string, unknown>}},
    });
    const react = {createElement, Fragment} as unknown as Parameters<typeof Markdoc.renderers.react>[1];
    const html = renderToString(createElement('div', null, Markdoc.renderers.react(unsafe, react)));
    expect(html).toContain('onerror');
  });
});

describe("variables, function, custom node, nested partial and {% if %}: compile 'runtime' vs 'build' bundles", () => {
  const root = path.join(dir, 'fx-parity');
  const page = path.join(root, 'pages/parity.md');
  const results = {} as Record<'runtime' | 'build', {props?: MarkdocDataProps; html: string}>;

  beforeAll(async () => {
    const files: Record<string, string> = {
      'pages/parity.md': [
        '---',
        'title: Parity',
        '---',
        '',
        '# {% $markdoc.frontmatter.title %} {% $product %}',
        '',
        '{% if equals($product, "Parity") %}',
        'IF-TRUE',
        '{% else /%}',
        'IF-FALSE',
        '{% /if %}',
        '',
        'Shout: {% shout("hi") %}',
        '',
        '{% widget label="W1" /%}',
        '',
        '{% partial file="outer.md" /%}',
        '',
      ].join('\n'),
      'markdoc/partials/outer.md': 'Outer partial\n\n{% partial file="inner.md" /%}\n',
      'markdoc/partials/inner.md': 'Inner partial {% $product %}\n',
      'markdoc/config.ts': "export default {variables: {product: 'Parity'}};\n",
      'markdoc/functions.ts':
        'export default {shout: {transform: (p: Record<string | number, unknown>) => String(p[0]).toUpperCase() + "!"}};\n',
      'markdoc/nodes.ts': [
        "import {createElement} from 'react';",
        'const Heading = (p: {level?: number; children?: unknown}) =>',
        "  createElement('h' + (p.level ?? 1), {'data-heading': String(p.level)}, p.children as never);",
        'export default {heading: {render: Heading, children: ["inline"], attributes: {level: {type: Number, required: true}}}};',
        '',
      ].join('\n'),
      'markdoc/tags.ts': [
        "import {createElement} from 'react';",
        "const Widget = (p: {label?: string}) => createElement('span', {'data-widget': p.label}, 'widget');",
        'export default {widget: {render: Widget, attributes: {label: {type: String}}}};',
        '',
      ].join('\n'),
    };
    for (const [rel, content] of Object.entries(files)) writeFile(path.join(root, rel), content);
    const options = {dir: root, pagesDir: path.join(root, 'pages')};
    const bundles = {
      runtime: await measureBuild(page, dir, 'parity-runtime.js', options, {minify: false}),
      build: await measureBuild(page, dir, 'parity-build.js', {...options, compile: 'build'}, {minify: false}),
    };
    for (const mode of ['runtime', 'build'] as const) {
      const mod = (await importBundle(bundles[mode])) as PageModule;
      const props = (await mod.getStaticProps?.({}))?.props;
      results[mode] = {props, html: await renderModule(mod, props ?? {})};
    }
  }, 120000);

  test('the rendered HTML has the variable, the if branch, the function, the custom node, the custom tag and both partials', () => {
    const html = results.build.html.replaceAll('<!-- -->', '');
    expect(
      missing(html, ['Parity Parity', 'IF-TRUE', 'HI!', 'data-heading="1"', 'data-widget="W1"', 'Outer partial']),
    ).toEqual([]);
    expect(missing(html, ['Inner partial Parity'])).toEqual([]);
    expect(html).not.toContain('IF-FALSE');
  });

  test('HTML and getStaticProps data are identical in the runtime and build bundles', () => {
    expect(results.build.html).toBe(results.runtime.html);
    expect(results.build.props).toEqual(results.runtime.props as MarkdocDataProps);
  });
});
