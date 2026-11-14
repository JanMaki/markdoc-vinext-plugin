/** 出力の種類と、種類ごとに変わる生成コードの断片。 */

/** App Router のページ、Pages Router のページ、ページ以外のコンポーネント。 */
export type ModuleKind = 'app-page' | 'pages-page' | 'component';

export function moduleKindOf(isPage: boolean, appMode: boolean): ModuleKind {
  if (!isPage) return 'component';
  return appMode ? 'app-page' : 'pages-page';
}

/** コンポーネントが描画する Markdoc データの式。 */
export function emitMarkdocValue(kind: ModuleKind): string {
  if (kind === 'app-page') return 'await getMarkdocData()';
  return kind === 'pages-page' ? 'props.markdoc' : 'getMarkdocData()';
}

/** `getMarkdocData` の宣言の前置き。公式ローダーと同じく、ページ以外では同期関数にする。 */
export function getMarkdocDataKeyword(kind: ModuleKind): string {
  return kind === 'component' ? '' : 'async ';
}

/** default export の `function` の前置き。App Router のページのみ async にする。 */
export function defaultExportKeyword(kind: ModuleKind): string {
  return kind === 'app-page' ? ' async' : '';
}
