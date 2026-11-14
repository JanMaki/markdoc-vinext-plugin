import {describe, expect, test} from 'bun:test';
import path from 'node:path';
import {getSchemaDir, resolveProjectRoot, tokenizerAndParseOptions, validateNextjsExports} from '../../src/options';
import {transformMarkdoc} from '../../src/transform';
import {markdoc} from '../../src/vite/plugin';
import {constValue, moduleShape, newExpressionArg} from '../helpers/ast';
import {appSample, pagesSample, tmpDirFor} from '../helpers/paths';
import {fixtureTransform, transformSample} from '../helpers/transform';

const fx = tmpDirFor(import.meta);
const transform = fixtureTransform(fx);

describe('schemaPath / dir', () => {
  test("schemaPath '' falls back to ./markdoc", () => {
    expect(getSchemaDir('/p', {schemaPath: ''})).toBe(path.resolve('/p', 'markdoc'));
  });

  test('resolveProjectRoot: dir (made absolute) wins over the fallback', () => {
    expect(resolveProjectRoot({dir: '/d'}, '/fallback')).toBe(path.resolve('/d'));
    expect(resolveProjectRoot({}, '/fallback')).toBe('/fallback');
  });

  test('options.dir overrides context.root in transformMarkdoc', async () => {
    const result = await transformMarkdoc('# x\n', {
      resourcePath: path.join(fx, 'pages/t.md'),
      root: '/nonexistent-root',
      options: {dir: fx},
    });
    expect(result.meta).toEqual({
      isPage: true,
      appMode: false,
      filepath: '/t.md',
      schemaDir: path.join(fx, 'markdoc'),
    });
  });
});

describe('nextjsExports validation', () => {
  for (const [bad, message] of [
    ['bad-name', 'is not a valid JavaScript identifier'],
    ['a = 1; globalThis.x = 1; export const b', 'is not a valid JavaScript identifier'],
    ['class', 'is a reserved word'],
    ['default', 'is a reserved word'],
    ['markdoc', 'collides with a name used by the generated module'],
    ['source', 'collides with a name used by the generated module'],
    ['JSON', 'collides with a name used by the generated module'],
    ['Date', 'collides with a name used by the generated module'],
    ['Object', 'collides with a name used by the generated module'],
    ['constructor', 'is a property of Object.prototype'],
    ['toString', 'is a property of Object.prototype'],
    ['__proto__', 'is a property of Object.prototype'],
    ['hasOwnProperty', 'is a property of Object.prototype'],
  ] as const) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => validateNextjsExports([bad])).toThrow(`[markdoc-vinext] nextjsExports: `);
      expect(() => validateNextjsExports([bad])).toThrow(message);
    });
  }

  test('rejects duplicates and non-strings', () => {
    expect(() => validateNextjsExports(['title', 'title'])).toThrow('is listed twice');
    expect(() => validateNextjsExports([1])).toThrow('is not a valid JavaScript identifier');
  });

  test('accepts custom identifiers in order', () => {
    expect(validateNextjsExports(['title', 'dynamic'])).toEqual(['title', 'dynamic']);
  });

  test('markdoc() validates nextjsExports at creation', () => {
    expect(() => markdoc({nextjsExports: ['bad-name']})).toThrow('nextjsExports');
  });

  test('custom nextjsExports replace the defaults on App pages', async () => {
    const {code} = await transform('---\nnextjs:\n  title: T\n---\n# x\n', 'app/x/page.md', {nextjsExports: ['title']});
    expect(moduleShape(code).exports).toEqual(['default', 'markdoc', 'title']);
  });
});

describe('tokenizer options', () => {
  test('default is {allowComments: true} without slots', () => {
    expect(tokenizerAndParseOptions({})).toEqual({
      tokenizerOptions: {allowComments: true},
      parseOptions: {slots: false},
    });
  });

  test('tokenizerOptions is an alias of options; options takes precedence', () => {
    expect(tokenizerAndParseOptions({tokenizerOptions: {typographer: true}}).tokenizerOptions).toEqual({
      typographer: true,
    });
    const both = tokenizerAndParseOptions({options: {allowComments: true}, tokenizerOptions: {typographer: true}});
    expect(both.tokenizerOptions).toEqual({allowComments: true});
  });

  test('slots goes to parseOptions, not to the Tokenizer', () => {
    expect(tokenizerAndParseOptions({options: {slots: true}})).toEqual({
      tokenizerOptions: {},
      parseOptions: {slots: true},
    });
  });

  test('own keys whose value is undefined are treated as absent', () => {
    expect(
      tokenizerAndParseOptions({options: {allowComments: undefined, slots: undefined, typographer: true}}),
    ).toEqual({tokenizerOptions: {typographer: true}, parseOptions: {slots: false}});
    expect(() => markdoc({options: {allowComments: undefined}})).not.toThrow();
  });

  test('options / tokenizerOptions that are not objects are rejected', () => {
    for (const value of [null, 'x', 1, true, [], [{allowComments: true}], () => undefined]) {
      for (const key of ['options', 'tokenizerOptions']) {
        expect(() => markdoc({[key]: value} as never)).toThrow('[markdoc-vinext] Tokenizer options must be an object.');
      }
    }
    // options が null でも tokenizerOptions には進まない。
    expect(() => markdoc({options: null, tokenizerOptions: {}} as never)).toThrow('must be an object');
  });

  test('a non-boolean slots value is rejected', () => {
    expect(() => markdoc({options: {slots: 'yes'} as never})).toThrow(
      '[markdoc-vinext] Tokenizer option "slots" must be a boolean, got string.',
    );
  });

  test('generated runtime code passes the same values to the Tokenizer and Markdoc.parse', async () => {
    const {code} = await transform('# x\n', 'components/x.md', {options: {typographer: true, slots: true}});
    expect(newExpressionArg(code, 'Markdoc.Tokenizer')).toEqual({typographer: true});
    expect(constValue(code, 'parseOptions')).toEqual({slots: true});
  });

  test('a "__proto__" tokenizer option stays an own property in the generated code', async () => {
    const options = JSON.parse('{"__proto__": {"x": 1}, "typographer": true}');
    const {code} = await transform('# x\n', 'components/x.md', {options});
    const arg = /new Markdoc\.Tokenizer\((JSON\.parse\(".*?"\))\)/.exec(code)?.[1];
    const evaluated = new Function(`return ${arg};`)() as object;
    expect(Object.hasOwn(evaluated, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(evaluated)).toBe(Object.prototype);
  });

  test('a function value is rejected with the key name', () => {
    expect(() => markdoc({options: {highlight: () => ''}})).toThrow('Tokenizer option "highlight" is a function');
  });

  test('a top-level RegExp value is rejected with the key name', () => {
    expect(() => markdoc({options: {re: /x/} as never})).toThrow('Tokenizer option "re" is a RegExp');
  });

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const [label, value] of [
    ['nested function', {f: () => 1}],
    ['function in an array', [() => 1]],
    ['nested undefined', {y: undefined}],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['bigint', 1n],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['symbol', Symbol('s')],
    ['sparse array', new Array(3)],
    ['symbol key', {[Symbol('k')]: 1}],
    ['nested RegExp', {re: /x/}],
    ['circular object', circular],
  ] as const) {
    test(`a ${label} value is rejected as not JSON-serializable`, () => {
      expect(() => markdoc({options: {x: value} as never})).toThrow('JSON-serializable');
    });
  }

  test('plain JSON values, -0 and null-prototype objects are accepted', () => {
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.a = 1;
    expect(() => markdoc({options: {maxNesting: -0} as never})).not.toThrow();
    expect(() => markdoc({options: {x: nullProto, y: [nullProto, -0]} as never})).not.toThrow();
    expect(() => markdoc({options: {nested: {list: [1, 'a', {b: null}]}} as never})).not.toThrow();
  });
});

describe('compile / router / mode values', () => {
  test('an invalid compile value is rejected at markdoc()', () => {
    expect(() => markdoc({compile: 'nope' as never})).toThrow(
      `[markdoc-vinext] compile must be 'runtime' or 'build', got "nope".`,
    );
  });

  // router と mode は検証しない。不正な値は既定値 ('auto' / 'static') と同じ結果になる。
  test('invalid router and mode values are accepted and behave as the defaults', async () => {
    expect(() => markdoc({router: 'nope' as never, mode: 'nope' as never})).not.toThrow();
    const app = await transformSample(appSample, {router: 'nope' as never});
    expect(app.meta.appMode).toBe(true);
    const pages = await transformSample(pagesSample, {router: 'nope' as never, mode: 'nope' as never});
    expect(pages.meta.appMode).toBe(false);
    expect(moduleShape(pages.code).exports).toContain('getStaticProps');
  });
});
