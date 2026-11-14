import {beforeAll, describe, expect, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fastRefreshComponentModule} from '../../src/page-detection';
import {transformMarkdoc} from '../../src/transform';
import type {MarkdocVitePluginOptions, TransformMarkdocResult} from '../../src/types';
import {writeTree} from '../helpers/fixtures';
import {exampleRoot, repoRoot as root} from '../helpers/paths';
import {parsesAsPlainJs} from '../helpers/transform';

/** スナップショットに含まれるパスのため、tmpDirFor の `generated` ではなく `golden` を使う。 */
const fixtures = path.join(root, 'tmp', 'test', 'golden');
const samples = {
  pages: 'examples/basic/pages/docs/getting-started.md',
  app: 'examples/basic/app/docs/page.md',
  component: 'examples/basic/components/note.md',
} as const;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** root（生の表記と JSON エスケープ済みの表記）以降のパスを `<root>/...` にする。 */
const rootPattern = new RegExp(
  `(?:${escapeRegExp(JSON.stringify(root).slice(1, -1))}|${escapeRegExp(root)})([^"'\`\\s)]*)`,
  'g',
);
const normalizeText = (text: string): string =>
  text.replace(rootPattern, (_, rest: string) => `<root>${rest.replace(/\\+/g, '/')}`);
const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/');

function normalizeMap(map: TransformMarkdocResult['map']) {
  if (!('sources' in map)) return 'none';
  return {
    sources: map.sources.map(relative),
    lineCount: map.mappings.split(';').length,
    sourcesContentHash: createHash('sha256').update(map.sourcesContent.join('')).digest('hex'),
  };
}

function normalize(result: TransformMarkdocResult) {
  return {
    code: normalizeText(result.code),
    map: normalizeMap(result.map),
    meta: JSON.parse(normalizeText(JSON.stringify(result.meta))),
    watchFiles: result.watchFiles.map(relative),
  };
}

type Case = {
  name: string;
  file: string;
  options: MarkdocVitePluginOptions;
  root?: string;
  consumer?: 'client' | 'server';
};

/** CRLF でチェックアウトされた環境でも同じ入力にする。 */
const readSource = async (file: string): Promise<string> => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');

const results = new Map<string, Promise<TransformMarkdocResult>>();
/** ケースの変換結果。同じケースは 1 回だけ変換する。 */
function run(c: Case): Promise<TransformMarkdocResult> {
  const key = JSON.stringify(c);
  let result = results.get(key);
  if (!result) {
    const resourcePath = path.resolve(root, c.file);
    result = readSource(resourcePath).then((source) =>
      transformMarkdoc(source, {
        resourcePath,
        root: c.root ?? exampleRoot,
        options: c.options,
        consumer: c.consumer ?? 'client',
      }),
    );
    results.set(key, result);
  }
  return result;
}

const matrixName = (label: string, compile: string, consumer: string, mode: string, fastRefresh: boolean) =>
  `${label} compile=${compile} consumer=${consumer} mode=${mode} fastRefresh=${fastRefresh}`;

/**
 * サンプル × compile × consumer × mode × fastRefresh の組み合わせ。
 * 出力に影響しない次元は `representative` で記録するケースを示す: compile=runtime の consumer、
 * App ページとコンポーネントの mode。
 */
function matrix(): {kept: Case[]; dropped: {c: Case; representative: Case}[]} {
  const kept: Case[] = [];
  const dropped: {c: Case; representative: Case}[] = [];
  for (const [label, file] of Object.entries(samples)) {
    for (const compile of ['runtime', 'build'] as const) {
      for (const consumer of ['client', 'server'] as const) {
        for (const mode of ['static', 'server'] as const) {
          for (const fastRefresh of [false, true]) {
            const c = {
              name: matrixName(label, compile, consumer, mode, fastRefresh),
              file,
              options: {compile, mode, fastRefresh},
              consumer,
            };
            const repConsumer = compile === 'runtime' ? 'client' : consumer;
            const repMode = label === 'pages' ? mode : 'static';
            if (repConsumer === consumer && repMode === mode) {
              kept.push(c);
            } else {
              const options = {compile, mode: repMode, fastRefresh};
              const name = matrixName(label, compile, repConsumer, repMode, fastRefresh);
              dropped.push({c, representative: {name, file, options, consumer: repConsumer}});
            }
          }
        }
      }
    }
  }
  return {kept, dropped};
}

/** router の強制。既定 (auto) と同じ形になる組み合わせは `dropped`。 */
function routerCases(): {kept: Case[]; dropped: {c: Case; representative: Case}[]} {
  const auto = (label: 'pages' | 'app'): Case => ({
    name: matrixName(label, 'runtime', 'client', 'static', false),
    file: samples[label],
    options: {compile: 'runtime', mode: 'static', fastRefresh: false},
    consumer: 'client',
  });
  const forced = (label: 'pages' | 'app', router: 'app' | 'pages'): Case => ({
    name: `${label} router=${router}`,
    file: samples[label],
    options: {router},
  });
  return {
    kept: [forced('pages', 'app'), forced('app', 'pages')],
    dropped: [
      {c: forced('pages', 'pages'), representative: auto('pages')},
      {c: forced('app', 'app'), representative: auto('app')},
    ],
  };
}

const fx = {
  noSchema: path.join(fixtures, 'no-schema'),
  frontmatter: path.join(fixtures, 'frontmatter'),
  proto: path.join(fixtures, 'proto-partial'),
};
const fxFile = (dir: string, rel: string): string => relative(path.join(dir, rel));

function edgeCases(): Case[] {
  const noSchemaPage = fxFile(fx.noSchema, 'pages/index.md');
  const cases: Case[] = [
    {
      name: "app nextjsExports=['title','dynamic']",
      file: samples.app,
      options: {nextjsExports: ['title', 'dynamic']},
      consumer: 'server',
    },
    // options.dir が context.root より優先され、root (examples/basic) の markdoc/ は使われない。
    {name: 'dir option compile=build', file: noSchemaPage, options: {dir: fx.noSchema, compile: 'build'}},
  ];
  for (const compile of ['runtime', 'build'] as const) {
    const suffix = compile === 'runtime' ? '' : ' compile=build';
    cases.push(
      {name: `missing schema dir${suffix}`, file: noSchemaPage, options: {compile}, root: fx.noSchema},
      {
        name: `pages tokenizer allowComments=false slots=true${suffix}`,
        file: samples.pages,
        options: {compile, options: {allowComments: false, slots: true}},
      },
    );
  }
  // Date・`$$mdtype` は compile: 'build' の直列化で差が出るため両方を記録する
  for (const compile of ['runtime', 'build'] as const) {
    const at = (dir: string, rel: string) => ({file: fxFile(dir, rel), options: {compile}, root: dir});
    cases.push(
      {name: `frontmatter Date compile=${compile}`, ...at(fx.frontmatter, 'pages/date.md')},
      {name: `frontmatter $$mdtype compile=${compile}`, ...at(fx.frontmatter, 'pages/mdtype.md')},
      {name: `partial __proto__.md compile=${compile}`, ...at(fx.proto, 'pages/index.md')},
    );
  }
  cases.push({
    name: 'frontmatter $$mdtype in an array compile=build',
    file: fxFile(fx.frontmatter, 'pages/mdtype-array.md'),
    options: {compile: 'build'},
    root: fx.frontmatter,
  });
  return cases;
}

const m = matrix();
const r = routerCases();
const transformCases = [...m.kept, ...r.kept, ...edgeCases()];

beforeAll(async () => {
  await rm(fixtures, {recursive: true, force: true});
  writeTree(fx.noSchema, {'pages/index.md': '# No schema\n'});
  writeTree(fx.frontmatter, {
    'pages/date.md':
      '---\ndate: 2024-01-02\nnested:\n  at: 2024-01-03T04:05:06Z\n---\n\n# {% $markdoc.frontmatter.date %}\n',
    'pages/mdtype.md': '---\nmeta:\n  $$mdtype: Tag\n  name: h1\n---\n\n# mdtype\n',
    'pages/mdtype-array.md': '---\nlist:\n  - $$mdtype: Tag\n    name: h1\n  - plain\n---\n\n# mdtype array\n',
  });
  writeTree(fx.proto, {
    'pages/index.md': '# Proto\n\n{% partial file="__proto__.md" /%}\n',
    'markdoc/partials/__proto__.md': 'Partial named __proto__.\n',
  });
});

describe('transformMarkdoc', () => {
  for (const c of transformCases) {
    test(c.name, async () => {
      expect(normalize(await run(c))).toMatchSnapshot();
    });
  }
});

describe('fastRefreshComponentModule', () => {
  for (const [label, file] of Object.entries(samples)) {
    test(label, () => {
      const {code, map} = fastRefreshComponentModule(path.resolve(root, file), exampleRoot, {});
      expect({code: normalizeText(code), map}).toMatchSnapshot();
    });
  }
});

describe('golden coverage', () => {
  test('combinations left out of the snapshots produce the same output as their representative', async () => {
    const pairs = [...m.dropped, ...r.dropped];
    expect(pairs).toHaveLength(26);
    const differing: string[] = [];
    for (const {c, representative} of pairs) {
      if (JSON.stringify(normalize(await run(c))) !== JSON.stringify(normalize(await run(representative)))) {
        differing.push(`${c.name} ≠ ${representative.name}`);
      }
    }
    expect(differing).toEqual([]);
  });

  test('every recorded module parses as plain JavaScript (no TS / JSX)', async () => {
    const codes: [string, string][] = [];
    for (const c of transformCases) codes.push([c.name, (await run(c)).code]);
    for (const [label, file] of Object.entries(samples)) {
      codes.push([
        `component module ${label}`,
        fastRefreshComponentModule(path.resolve(root, file), exampleRoot, {}).code,
      ]);
    }
    const failing: string[] = [];
    for (const [name, code] of codes) if (!(await parsesAsPlainJs(code))) failing.push(name);
    expect(codes.length).toBe(transformCases.length + 3);
    expect(failing).toEqual([]);
  });
});
