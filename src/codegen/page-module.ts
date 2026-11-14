/**
 * ページ / コンポーネントモジュール全体の生成。
 * @markdoc/next.js の src/loader.js を元にしている (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
 */

import path from 'node:path';
import {COMPONENT_QUERY} from '../module-ids';
import type {MarkdocVitePluginOptions} from '../types';
import {defaultExportKeyword, emitMarkdocValue, type ModuleKind} from './shared';

type PageModuleSpec = {
  kind: ModuleKind;
  /** emitRuntimeHead / emitBuildHead の出力。 */
  head: string;
  options: Pick<MarkdocVitePluginOptions, 'mode' | 'fastRefresh'>;
  /** validateNextjsExports で検証済みの識別子。 */
  nextjsExports: string[];
  resourcePath: string;
};

/** Pages Router のページのデータ取得関数。 */
function emitDataFetchingExport(kind: ModuleKind, mode: MarkdocVitePluginOptions['mode']): string {
  if (kind !== 'pages-page') return '';
  const name = mode === 'server' ? 'getServerSideProps' : 'getStaticProps';
  return `export async function ${name}(context) {
  return {
    props: {
      markdoc: await getMarkdocData(context),
    },
  };
}
`;
}

/** App Router のページが export する `frontmatter.nextjs` の値。 */
function emitNextjsExports(kind: ModuleKind, names: string[]): string {
  if (kind !== 'app-page') return '';
  return `${names.map((name) => `export const ${name} = frontmatter.nextjs?.${name};`).join('\n')}\n`;
}

function emitDefaultExport(spec: PageModuleSpec): string {
  if (spec.options.fastRefresh) {
    return `// fastRefresh: Fast Refresh の境界にするため、コンポーネントを別モジュールに置く。
export const __markdocInternal = {components, getMarkdocData, renderers: Markdoc.renderers};
export {default} from ${JSON.stringify(`./${path.basename(spec.resourcePath)}?${COMPONENT_QUERY}`)};
if (import.meta.hot) import.meta.hot.accept();
`;
  }
  return `export default${defaultExportKeyword(spec.kind)} function MarkdocComponent(props) {
  const markdoc = ${emitMarkdocValue(spec.kind)};
  return Markdoc.renderers.react(markdoc.content, React, {
    components: {
      ...components,
      ...props.components,
    },
  });
}
`;
}

/** 先頭部分に export を続けたモジュール全体。 */
export function emitPageModule(spec: PageModuleSpec): string {
  return `${spec.head}
${emitDataFetchingExport(spec.kind, spec.options.mode)}${emitNextjsExports(spec.kind, spec.nextjsExports)}export const markdoc = {frontmatter};
${emitDefaultExport(spec)}`;
}
