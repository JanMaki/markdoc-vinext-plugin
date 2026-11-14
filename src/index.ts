/**
 * Markdoc (.md / .mdoc) ファイルを React コンポーネントモジュールに変換する Vite プラグイン。
 * @markdoc/next.js の webpack ローダー (src/loader.js) と同じ形式のモジュールを生成する。
 * webpack/Turbopack ローダーを実行しない Vinext 向け。
 */

export type {MarkdocNextJsPageProps, MarkdocRouter, MarkdocTokenizerOptions, MarkdocVitePluginOptions} from './types';
export {markdoc, markdoc as default} from './vite/plugin';
