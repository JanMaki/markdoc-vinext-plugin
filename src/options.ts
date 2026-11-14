/** オプションの既定値と検証。 */

import path from 'node:path';
import {GENERATED_MODULE_NAMES} from './codegen/names';
import type {MarkdocVitePluginOptions} from './types';

const DEFAULT_SCHEMA_PATH = './markdoc';
/** `extensions` の既定値。 */
export const DEFAULT_EXTENSIONS = ['.md', '.mdoc'];
/** `partialExtensions` の既定値。`extensions` とは独立したオプションのため、値が同じでも別の定数にする。 */
export const DEFAULT_PARTIAL_EXTENSIONS = ['.md', '.mdoc'];
export const DEFAULT_NEXTJS_EXPORTS = ['metadata', 'revalidate'];

/** export 名として宣言できない識別子 (予約語と strict mode で束縛できない名前)。 */
const RESERVED_WORDS = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if implements import in instanceof interface let new null package ' +
    'private protected public return static super switch this throw true try typeof var void while with yield ' +
    'arguments eval undefined NaN Infinity'
  ).split(' '),
);

/** JSON.stringify → JSON.parse で同じ値に戻るか。-0 は 0 になるが同じ値として扱う。 */
function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (!isArray && proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(value).some((key) => Object.prototype.propertyIsEnumerable.call(value, key))) {
    return false;
  }
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(
    ([key, descriptor]) => descriptor.enumerable || (isArray && key !== 'length'),
  );
  // 疎な配列の穴は null になる。
  if (isArray && descriptors.length !== (value as unknown[]).length) return false;
  ancestors.add(value);
  // getter は JSON.stringify で値に置き換わる。
  const ok = descriptors.every(([, descriptor]) => 'value' in descriptor && isJsonValue(descriptor.value, ancestors));
  ancestors.delete(value);
  return ok;
}

/** 値が `undefined` の自身のプロパティを除いた複製。`undefined` は指定なしとして扱う。 */
function withoutUndefined(raw: object): Record<PropertyKey, unknown> {
  const output: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || ('value' in descriptor && descriptor.value === undefined)) continue;
    Object.defineProperty(output, key, descriptor);
  }
  return output;
}

/** `options`、`tokenizerOptions`、既定値の順に最初の指定値。オブジェクト以外は例外を投げる。 */
function rawTokenizerOptions(pluginOptions: MarkdocVitePluginOptions): object {
  const {options, tokenizerOptions} = pluginOptions as {options?: unknown; tokenizerOptions?: unknown};
  const raw =
    options !== undefined ? options : tokenizerOptions !== undefined ? tokenizerOptions : {allowComments: true};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('[markdoc-vinext] Tokenizer options must be an object.');
  }
  return raw;
}

/** Tokenizer と parse に渡すオプション。JSON にできない値は例外を投げる。 */
export function tokenizerAndParseOptions(pluginOptions: MarkdocVitePluginOptions): {
  tokenizerOptions: Record<string, unknown>;
  parseOptions: {slots: boolean};
} {
  const {slots = false, ...tokenizerOptions} = withoutUndefined(rawTokenizerOptions(pluginOptions));
  if (typeof slots !== 'boolean') {
    throw new Error(`[markdoc-vinext] Tokenizer option "slots" must be a boolean, got ${typeof slots}.`);
  }
  for (const [key, value] of Object.entries(tokenizerOptions)) {
    if (typeof value === 'function' || value instanceof RegExp) {
      throw new Error(
        `[markdoc-vinext] Tokenizer option "${key}" is a ${typeof value === 'function' ? 'function' : 'RegExp'}; options are embedded with JSON.stringify and must be JSON-serializable.`,
      );
    }
  }
  // 入れ子の関数、undefined、クラスのインスタンス等は JSON.stringify で失われ、変換時と実行時で結果が変わる。
  if (!isJsonValue(tokenizerOptions, new Set())) {
    throw new Error(
      '[markdoc-vinext] Tokenizer options are embedded with JSON.stringify and must be JSON-serializable (no nested functions, RegExps, undefined values or class instances).',
    );
  }
  return {
    tokenizerOptions,
    parseOptions: {slots},
  };
}

/** プロジェクトルート。`dir` があれば絶対パスにして使い、なければ `fallback` (Vite の `config.root`)。 */
export function resolveProjectRoot(options: MarkdocVitePluginOptions, fallback: string): string {
  return options.dir ? path.resolve(options.dir) : fallback;
}

/** `schemaPath` の値。`''` は公式ローダーと同じく既定値として扱う。 */
export function resolveSchemaPath(options: MarkdocVitePluginOptions): string {
  return options.schemaPath || DEFAULT_SCHEMA_PATH;
}

/** resolveSchemaPath の値が既定値か。既定のフォルダは存在しなくてもエラーにしない。 */
export function isDefaultSchemaPath(schemaPath: string): boolean {
  return schemaPath === DEFAULT_SCHEMA_PATH;
}

/** スキーマフォルダの絶対パス。 */
export function getSchemaDir(root: string, options: MarkdocVitePluginOptions): string {
  return path.resolve(root, resolveSchemaPath(options));
}

/** `nextjsExports` を検証する。不正なコードや名前の衝突を生む値は例外を投げる。 */
export function validateNextjsExports(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(`[markdoc-vinext] nextjsExports: ${JSON.stringify(name)} is not a valid JavaScript identifier.`);
    }
    if (RESERVED_WORDS.has(name)) {
      throw new Error(`[markdoc-vinext] nextjsExports: "${name}" is a reserved word.`);
    }
    if (GENERATED_MODULE_NAMES.has(name)) {
      throw new Error(`[markdoc-vinext] nextjsExports: "${name}" collides with a name used by the generated module.`);
    }
    // `frontmatter.nextjs?.constructor` 等は frontmatter にキーがなくても継承したプロパティを返す。
    if (name in Object.prototype) {
      throw new Error(`[markdoc-vinext] nextjsExports: "${name}" is a property of Object.prototype.`);
    }
    if (seen.has(name)) {
      throw new Error(`[markdoc-vinext] nextjsExports: "${name}" is listed twice.`);
    }
    seen.add(name);
  }
  return [...seen];
}

/** 不正なオプションは最初のファイル変換時ではなくプラグイン生成時にエラーにする。 */
export function validatePluginOptions(pluginOptions: MarkdocVitePluginOptions): void {
  validateNextjsExports(pluginOptions.nextjsExports ?? DEFAULT_NEXTJS_EXPORTS);
  tokenizerAndParseOptions(pluginOptions);
  if (pluginOptions.compile !== undefined && pluginOptions.compile !== 'runtime' && pluginOptions.compile !== 'build') {
    throw new Error(
      `[markdoc-vinext] compile must be 'runtime' or 'build', got ${JSON.stringify(pluginOptions.compile)}.`,
    );
  }
}
