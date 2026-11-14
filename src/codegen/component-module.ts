/** `fastRefresh: true` の `<file>?markdoc-component` モジュールの生成。 */

import path from 'node:path';
import {defaultExportKeyword, emitMarkdocValue, type ModuleKind} from './shared';

/**
 * コンポーネントのみを default export し、@vitejs/plugin-react が Fast Refresh の境界として扱えるようにする。
 * データはページモジュールから取得する (循環 import、描画時に参照)。
 */
export function emitComponentModule(spec: {kind: ModuleKind; resourcePath: string}): string {
  return `// @vitejs/plugin-react は react/jsx-runtime の有無で Fast Refresh の対象を判定するため jsx() を使う。
import {jsx} from 'react/jsx-runtime';
import React from 'react';
import {__markdocInternal} from ${JSON.stringify(`./${path.basename(spec.resourcePath)}`)};

export default${defaultExportKeyword(spec.kind)} function MarkdocComponent(props) {
  const {components, getMarkdocData, renderers} = __markdocInternal;
  const markdoc = ${emitMarkdocValue(spec.kind)};
  return jsx(React.Fragment, {
    children: renderers.react(markdoc.content, React, {
      components: {...components, ...props.components},
    }),
  });
}
if (import.meta.hot) import.meta.hot.accept();
`;
}
