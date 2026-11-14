import {describe, expect, test} from 'bun:test';
import {constValue} from '../helpers/ast';
import {pagesSample, tmpDirFor} from '../helpers/paths';
import {extractMarkdocData, fixtureTransform, noParserOrRaw, transformSample} from '../helpers/transform';

const transform = fixtureTransform(tmpDirFor(import.meta));

/** compile: 'build' の生成コードの `const frontmatter = ...;` の式を評価する。 */
function evalFrontmatter(code: string): Record<string, unknown> {
  const match = /const frontmatter = ([\s\S]*?);\n\n/.exec(code);
  if (!match?.[1]) throw new Error('frontmatter declaration not found');
  return new Function(`return ${match[1]};`)() as Record<string, unknown>;
}

describe("compile: 'build' variants", () => {
  test('client: no parser / js-yaml / raw source / raw partials; the pre-transformed data is embedded', async () => {
    const {code} = await transformSample(pagesSample, {compile: 'build'}, {consumer: 'client'});
    expect(noParserOrRaw(code)).toEqual([]);
    expect(extractMarkdocData(code)).toMatchObject({
      content: {$$mdtype: 'Tag'},
      frontmatter: {title: 'Get started with Markdoc'},
      file: {path: '/docs/getting-started.md'},
    });
  });

  test('client with mode server is also slim', async () => {
    const {code} = await transformSample(pagesSample, {compile: 'build', mode: 'server'}, {consumer: 'client'});
    expect(noParserOrRaw(code)).toEqual([]);
  });

  test('server with mode static is pre-transformed and imports the Markdoc renderer only', async () => {
    const {code} = await transformSample(pagesSample, {compile: 'build'}, {consumer: 'server'});
    expect(noParserOrRaw(code)).toEqual(['@markdoc/markdoc']);
    expect(extractMarkdocData(code)).not.toBeNull();
  });

  test('server with mode server keeps the runtime transform (context.variables)', async () => {
    const {code} = await transformSample(pagesSample, {compile: 'build', mode: 'server'}, {consumer: 'server'});
    expect(noParserOrRaw(code)).toEqual(expect.arrayContaining(['Tokenizer', 'const source']));
    expect(extractMarkdocData(code)).toBeNull();
  });

  test("the default compile is 'runtime' even for the client consumer", async () => {
    const {code} = await transformSample(pagesSample, {}, {consumer: 'client'});
    expect(noParserOrRaw(code)).toEqual(expect.arrayContaining(['Tokenizer', 'const source']));
  });
});

describe("compile: 'build' frontmatter Dates", () => {
  test('real Dates are restored; a user `$markdocDate` key and a `__proto__` key stay plain', async () => {
    const source = [
      '---',
      'd: 2020-01-02',
      'ds: [2020-01-03, {x: 2021-03-04}]',
      'fake: {"$markdocDate": "1999-01-01T00:00:00.000Z"}',
      '__proto__: {at: 2022-05-06}',
      '---',
      'hi',
      '',
    ].join('\n');
    const {code} = await transform(source, 'pages/date.md', {compile: 'build'}, {consumer: 'client'});
    const fm = evalFrontmatter(code);
    expect(fm.d).toEqual(new Date('2020-01-02T00:00:00.000Z'));
    const ds = fm.ds as [Date, {x: Date}];
    expect(ds[0]).toBeInstanceOf(Date);
    expect(ds[1].x).toBeInstanceOf(Date);
    expect(fm.fake).toEqual({$markdocDate: '1999-01-01T00:00:00.000Z'});
    expect(Object.getPrototypeOf(fm)).toBe(Object.prototype);
    const proto = Object.getOwnPropertyDescriptor(fm, '__proto__')?.value as {at?: unknown} | undefined;
    expect(proto?.at).toBeInstanceOf(Date);
  });

  test('frontmatter without Dates is a plain JSON.parse', async () => {
    const {code} = await transform('---\nt: 1\n---\nhi\n', 'pages/nodate.md', {compile: 'build'});
    expect(constValue(code, 'frontmatter')).toEqual({t: 1});
  });
});
