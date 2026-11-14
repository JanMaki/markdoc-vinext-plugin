import {beforeAll, describe, expect, test} from 'bun:test';
import path from 'node:path';
import {load as yamlLoad} from 'js-yaml';
import {loadFrontmatter} from '../../src/frontmatter';
import {writeFile} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {extractMarkdocData, fixtureTransform} from '../helpers/transform';

const fx = tmpDirFor(import.meta);
const transform = fixtureTransform(fx);
const page = path.join(fx, 'pages/t.md');

beforeAll(() => writeFile(path.join(fx, 'markdoc/tags.ts'), 'export default {};\n'));

/** YAML のエイリアスを 10^6 個に展開する frontmatter。 */
const BILLION_LAUGHS = [
  'a: &a [x, x, x, x, x, x, x, x, x, x]',
  ...['b', 'c', 'd', 'e', 'f'].map((name, i) => `${name}: &${name} [${Array(10).fill(`*${'abcde'[i]}`).join(', ')}]`),
].join('\n');

const CIRCULAR = '[markdoc-vinext] Frontmatter contains a circular reference.';

describe('invalid YAML frontmatter fails at transform time with the file name', () => {
  for (const [label, yaml, detail] of [
    ['unclosed flow sequence', 'title: [unclosed', 'unexpected end of the stream'],
    ['self-referencing alias in a sequence', 'a: &x [*x]', CIRCULAR],
    ['self-referencing alias in a mapping', 'a: &x {b: *x}', CIRCULAR],
    ['alias expansion over the value limit', BILLION_LAUGHS, 'more than'],
  ] as const) {
    test(label, async () => {
      const run = transform(`---\n${yaml}\n---\n# X\n`);
      await expect(run).rejects.toThrow(`[markdoc-vinext] Invalid YAML frontmatter in ${page}: `);
      await expect(run).rejects.toThrow(detail);
    });
  }
});

describe('loadFrontmatter', () => {
  const load = (raw: unknown) => loadFrontmatter(raw, yamlLoad, '/f.md');

  test('missing, empty and scalar YAML become {}; a sequence is kept as an array', () => {
    for (const raw of [undefined, '', '~', 'hello', '42']) expect(load(raw)).toEqual({});
    expect(load('[1, 2]') as unknown).toEqual([1, 2]);
  });

  test('$$mdtype is removed at every depth and shared aliases are kept', () => {
    const fm = load('meta: {$$mdtype: Tag, name: h1}\nlist: [{$$mdtype: Tag, k: 1}]\nshared: &s {v: 1}\ncopy: *s\n');
    expect(fm).toEqual({meta: {name: 'h1'}, list: [{k: 1}], shared: {v: 1}, copy: {v: 1}});
  });

  test('`!!binary` becomes a plain number array', () => {
    expect(load('b: !!binary AQL/\n')).toEqual({b: [1, 2, 255]});
  });

  test('the error message names the given file', () => {
    expect(() => load('a: [')).toThrow('[markdoc-vinext] Invalid YAML frontmatter in /f.md: ');
  });
});

describe("compile: 'build' frontmatter edge cases", () => {
  const buildTransform = fixtureTransform(fx);
  const dataOf = async (source: string) => {
    const {code} = await buildTransform(source, 'pages/t.md', {compile: 'build'});
    return extractMarkdocData(code) as {content: unknown; frontmatter: Record<string, unknown>};
  };

  test('BOM + CRLF frontmatter is parsed and available as a variable', async () => {
    const data = await dataOf('﻿---\r\ntitle: Bom Title\r\n---\r\n\r\n# Heading {% $markdoc.frontmatter.title %}\r\n');
    expect(data.frontmatter).toEqual({title: 'Bom Title'});
    expect(JSON.stringify(data.content)).toContain('"children":["Heading ","Bom Title"]');
  });

  test('no frontmatter, an empty file, scalar YAML and null YAML give {}', async () => {
    for (const source of ['# Plain\n', '', '---\nhello\n---\n# Scalar\n', '---\n~\n---\n# Null\n']) {
      expect([source, (await dataOf(source)).frontmatter]).toEqual([source, {}]);
    }
  });

  test('`!!binary` is embedded as the same number array as at runtime', async () => {
    expect((await dataOf('---\nb: !!binary AQL/\n---\n# B\n')).frontmatter).toEqual({b: [1, 2, 255]});
  });

  test('an empty file renders an empty article', async () => {
    expect((await dataOf('')).content).toMatchObject({name: 'article', children: []});
  });
});
