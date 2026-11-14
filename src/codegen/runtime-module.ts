/** compile: 'runtime' のモジュールの先頭部分の生成。 */

import {RUNTIME_MODULE_ID} from '../module-ids';
import {getMarkdocDataKeyword, type ModuleKind} from './shared';

type RuntimeHeadSpec = {
  kind: ModuleKind;
  /** emitSchemaCode の出力。 */
  schemaCode: string;
  tokenizerOptions: Record<string, unknown>;
  parseOptions: {slots: boolean};
  source: string;
  filepath: string | undefined;
  /** partial のファイル名 → 内容。 */
  partials: Record<string, string>;
};

/**
 * ソースと partial を埋め込み、実行時に parse / transform するモジュールの先頭部分。
 * @markdoc/next.js の src/loader.js を元にしている (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
 */
export function emitRuntimeHead(spec: RuntimeHeadSpec): string {
  // "__proto__" 等のキーを自身のプロパティとして渡すため、オブジェクトリテラルではなく JSON.parse を使う。
  const tokenizerInit = Object.keys(spec.tokenizerOptions).length
    ? `JSON.parse(${JSON.stringify(JSON.stringify(spec.tokenizerOptions))})`
    : '';
  const transformCall = spec.kind === 'component' ? 'Markdoc.transform(ast, cfg)' : 'await Markdoc.transform(ast, cfg)';
  return `import React from 'react';
// js-yaml v5 には default export がなく、Vite 8 / Rolldown は default import をエラーにする。
import {load as yamlLoad} from 'js-yaml';
// default import は Vite の CJS interop と Node ESM の両方で動く。
import Markdoc from '@markdoc/markdoc';

import {getSchema, defaultObject, sanitizeFrontmatter} from ${JSON.stringify(RUNTIME_MODULE_ID)};
// スキーマモジュールは Vite のパイプライン (TypeScript / ESM) で処理する。
${spec.schemaCode}

const tokenizer = new Markdoc.Tokenizer(${tokenizerInit});

const source = ${JSON.stringify(spec.source)};
const filepath = ${JSON.stringify(spec.filepath)};
const tokens = tokenizer.tokenize(source);
const parseOptions = ${JSON.stringify(spec.parseOptions)};
const ast = Markdoc.parse(tokens, parseOptions);

// オブジェクト以外の YAML (\`~\`、\`null\`、スカラー) は {} にし、\`frontmatter.nextjs\` で例外を出さない。
const frontmatter = (() => {
  const loaded = ast.attributes.frontmatter ? yamlLoad(ast.attributes.frontmatter) : {};
  return loaded && typeof loaded === 'object' ? sanitizeFrontmatter(loaded) : {};
})();

const {components, ...rest} = getSchema(schema);

${getMarkdocDataKeyword(spec.kind)}function getMarkdocData(context = {}) {
  // "__proto__" 等のキーを自身のプロパティとして残すため、オブジェクトリテラルではなく JSON.parse を使う。
  const partials = JSON.parse(${JSON.stringify(JSON.stringify(spec.partials))});

  // Markdoc.transform は partial を AST で受け取る。
  Object.keys(partials).forEach((key) => {
    const tokens = tokenizer.tokenize(partials[key]);
    partials[key] = Markdoc.parse(tokens, parseOptions);
  });

  const cfg = {
    ...rest,
    variables: {
      ...(rest ? rest.variables : {}),
      markdoc: {frontmatter},
      // getServerSideProps から渡すリクエスト時の変数。
      ...(context.variables || {})
    },
    partials,
    source,
  };

  // server 側の変数を使えるよう、データ取得関数の中で transform する。
  const content = ${transformCall};

  // undefined の値を除去する。
  return JSON.parse(
    JSON.stringify({
      content,
      frontmatter,
      file: {
        path: filepath,
      },
    })
  );
}
`;
}
