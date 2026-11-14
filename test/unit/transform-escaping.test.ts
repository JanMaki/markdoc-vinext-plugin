import {beforeAll, describe, expect, test} from 'bun:test';
import path from 'node:path';
import {fastRefreshComponentModule} from '../../src/page-detection';
import {constValue, newExpressionArg} from '../helpers/ast';
import {writeFile} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {extractMarkdocData, fixtureTransform, parsesAsPlainJs} from '../helpers/transform';

const fx = tmpDirFor(import.meta);
const transform = fixtureTransform(fx);

/** U+2028 (LINE SEPARATOR) / U+2029 (PARAGRAPH SEPARATOR)。 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
/** 文字列リテラルやテンプレート、コメント、HTML の script を壊す文字の並び。 */
const HOSTILE = ['A', LS, 'B', PS, 'C`D$', '{E}*/F\\G"H\'I</script><!--J'].join('');
/** ファイル名に使える範囲の HOSTILE。 */
const HOSTILE_NAME = ['n`$', "{'}", LS, PS].join('');

const partialName = `${HOSTILE_NAME}.md`;
const pageRel = `pages/${HOSTILE_NAME}.md`;
const filepath = `/${HOSTILE_NAME}.md`;
const partialContent = `Partial ${HOSTILE}\n`;
/** YAML の二重引用符の文字列。U+2028 / U+2029 はエスケープする。 */
const unicodeEscape = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const yamlString = JSON.stringify(HOSTILE).replaceAll(LS, unicodeEscape(LS)).replaceAll(PS, unicodeEscape(PS));
const source = `---\ntitle: ${yamlString}\n---\n\n# Body ${HOSTILE}\n\n{% partial file=${JSON.stringify(partialName)} /%}\n`;
const tokenizerOptions = {allowComments: true, hostile: HOSTILE};

beforeAll(() => writeFile(path.join(fx, 'markdoc/partials', partialName), partialContent));

/** renderable tree の文字列の子を連結する。 */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object') return textOf((node as {children?: unknown}).children ?? []);
  return '';
}

describe('hostile strings survive embedding in the generated module', () => {
  for (const fastRefresh of [false, true]) {
    test(`compile: 'runtime', fastRefresh ${fastRefresh}: source, partials, file path and tokenizer options round-trip`, async () => {
      const {code} = await transform(source, pageRel, {options: tokenizerOptions, fastRefresh});
      expect(await parsesAsPlainJs(code)).toBe(true);
      expect(constValue(code, 'source')).toBe(source);
      expect(constValue(code, 'partials')).toEqual({[partialName]: partialContent});
      expect(constValue(code, 'filepath')).toBe(filepath);
      expect(newExpressionArg(code, 'Markdoc.Tokenizer')).toEqual(tokenizerOptions);
    });
  }

  for (const consumer of ['client', 'server'] as const) {
    test(`compile: 'build', ${consumer}: frontmatter, content and file path round-trip`, async () => {
      const {code} = await transform(source, pageRel, {compile: 'build', options: tokenizerOptions}, {consumer});
      expect(await parsesAsPlainJs(code)).toBe(true);
      const data = extractMarkdocData(code) as {content: unknown; frontmatter: {title: string}; file: {path: string}};
      expect(data).not.toBeNull();
      expect(data.frontmatter.title).toBe(HOSTILE);
      expect(data.file.path).toBe(filepath);
      expect(constValue(code, 'frontmatter')).toEqual({title: HOSTILE});
      const text = textOf(data.content);
      expect(text).toContain(`Body ${HOSTILE}`);
      expect(text).toContain(`Partial ${HOSTILE}`);
    });
  }

  test('the fastRefresh component module imports the page by its hostile file name', async () => {
    const {code} = fastRefreshComponentModule(path.join(fx, pageRel), fx, {});
    expect(await parsesAsPlainJs(code)).toBe(true);
    const imports = new Bun.Transpiler({loader: 'js'}).scanImports(code).map((i) => i.path);
    expect(imports).toEqual(['react/jsx-runtime', 'react', `./${HOSTILE_NAME}.md`]);
  });
});
