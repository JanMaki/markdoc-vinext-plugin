import fs from 'node:fs';
import path from 'node:path';
import {transformWithEsbuild} from 'vite';
import {transformMarkdoc} from '../../src/transform';
import type {MarkdocVitePluginOptions} from '../../src/types';
import {constValue} from './ast';
import {containsMarker, errorMessage} from './code';
import {exampleRoot} from './paths';

export type TransformContext = Parameters<typeof transformMarkdoc>[1];
export type TransformResult = Awaited<ReturnType<typeof transformMarkdoc>>;

/** サンプルファイルを `exampleRoot` をルートとして変換する。 */
export async function transformSample(
  file: string,
  options: MarkdocVitePluginOptions = {},
  extra: Partial<TransformContext> = {},
): Promise<TransformResult> {
  const source = await fs.promises.readFile(file, 'utf8');
  return transformMarkdoc(source, {
    resourcePath: file,
    root: exampleRoot,
    options,
    ...extra,
  });
}

/** `root` 配下のフィクスチャを変換する関数を作る。`rel` は root からの相対パス。 */
export function fixtureTransform(root: string) {
  return (
    source: string,
    rel = 'pages/t.md',
    options: MarkdocVitePluginOptions = {},
    extra: Partial<TransformContext> = {},
  ): Promise<TransformResult> =>
    transformMarkdoc(source, {resourcePath: path.join(root, rel), root, options, ...extra});
}

/** `fn` が投げた例外の message を返す。投げなければ ''。 */
export async function expectThrowMessage(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return errorMessage(error);
  }
  return '';
}

/** TS / JSX を含まないプレーンな ESM JavaScript として解釈できるか。 */
export async function parsesAsPlainJs(code: string): Promise<boolean> {
  try {
    await transformWithEsbuild(code, 'generated.js', {loader: 'js', format: 'esm'});
    return true;
  } catch {
    return false;
  }
}

/** 生成コードの `const markdocData = "<JSON 文字列>";` の値。宣言がない、または parse できなければ null。 */
export function extractMarkdocData(code: string): {content: unknown; [key: string]: unknown} | null {
  try {
    return JSON.parse(constValue(code, 'markdocData') as string);
  } catch {
    return null;
  }
}

/** Pages のサンプルに含まれる Markdown の断片。 */
export const PAGE_RAW_MARKERS = ['{% callout', '{% $product', 'upper("hello")', 'title: Get started'];
/** footer の partial に含まれる Markdown の断片。 */
export const PARTIAL_RAW_MARKER = '`{% partial';
/** 軽量 client にはいずれも含まれてはならない。 */
export const RAW_MARKERS = [...PAGE_RAW_MARKERS, PARTIAL_RAW_MARKER];

/** パーサ、js-yaml、生のソース、生の partial が残っていれば、その名前の一覧。空なら残っていない。 */
export function noParserOrRaw(code: string): string[] {
  return [
    code.includes('Tokenizer') && 'Tokenizer',
    /js-yaml|FAILSAFE_SCHEMA|YAMLException/.test(code) && 'js-yaml',
    /@markdoc\/markdoc/.test(code) && '@markdoc/markdoc',
    code.includes('const source') && 'const source',
    code.includes('Markdoc.parse') && 'Markdoc.parse',
    ...RAW_MARKERS.filter((m) => containsMarker(code, m)),
  ].filter((x): x is string => Boolean(x));
}
