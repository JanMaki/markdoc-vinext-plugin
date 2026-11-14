/** compile: 'build' のモジュールの先頭部分の生成と、埋め込む frontmatter の直列化。 */

import {RUNTIME_MODULE_ID} from '../module-ids';
import {getMarkdocDataKeyword, type ModuleKind} from './shared';

/** キーと配列の添字の列。 */
export type DatePath = (string | number)[];

/** 有効な Date のパスを集める。 */
function collectDatePaths(value: unknown, at: DatePath, out: DatePath[]): void {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) out.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectDatePaths(item, [...at, index], out);
    });
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) collectDatePaths(item, [...at, key], out);
  }
}

/**
 * frontmatter を JSON にする。JSON では ISO 文字列になる Date のパスを `datePaths` に入れ、
 * emitBuildHead の生成コードで Date に戻す。
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): {json: string; datePaths: DatePath[]} {
  const datePaths: DatePath[] = [];
  collectDatePaths(frontmatter, [], datePaths);
  return {json: JSON.stringify(frontmatter), datePaths};
}

/** export する frontmatter の式。Date は compile: 'runtime' と同じく Date のまま復元する。 */
function emitFrontmatterValue(json: string, datePaths: DatePath[]): string {
  const parse = `JSON.parse(${JSON.stringify(json)})`;
  if (!datePaths.length) return parse;
  return `((value) => {
  for (const keys of ${JSON.stringify(datePaths)}) {
    const parent = keys.slice(0, -1).reduce((target, key) => target[key], value);
    parent[keys[keys.length - 1]] = new Date(parent[keys[keys.length - 1]]);
  }
  return value;
})(${parse})`;
}

type BuildHeadSpec = {
  kind: ModuleKind;
  consumer: 'client' | 'server';
  /** emitSchemaCode の出力。 */
  schemaCode: string;
  /** `{content, frontmatter, file}` の JSON。 */
  data: string;
  /** serializeFrontmatter の出力。 */
  frontmatter: {json: string; datePaths: DatePath[]};
};

/** ビルド時に transform した renderable tree を埋め込むモジュールの先頭部分。 */
export function emitBuildHead(spec: BuildHeadSpec): string {
  const markdocImport =
    spec.consumer === 'client'
      ? // @markdoc/markdoc は tree-shaking できない (markdown-it が残る) ため、client にはインラインのレンダラーを使う。
        'const Markdoc = {renderers: {react: renderReact}};'
      : "import Markdoc from '@markdoc/markdoc';";
  return `import React from 'react';
import {getSchema, defaultObject, renderReact} from ${JSON.stringify(RUNTIME_MODULE_ID)};
// 下の tree はビルド時に transform 済み (compile: 'build')。client は同梱のレンダラーのみ使う。
${markdocImport}
// 描画コンポーネントのためにスキーマモジュールを import する。
${spec.schemaCode}

const {components} = getSchema(schema);
// transform 済みの renderable tree。ソース、partial、YAML ローダーは含まない。
const markdocData = ${JSON.stringify(spec.data)};
const frontmatter = ${emitFrontmatterValue(spec.frontmatter.json, spec.frontmatter.datePaths)};

${getMarkdocDataKeyword(spec.kind)}function getMarkdocData() {
  return JSON.parse(markdocData);
}
`;
}
