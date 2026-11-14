/** プラグインのオプションと変換処理の型。 */

import type Markdoc from '@markdoc/markdoc';

export type MarkdocRouter = 'pages' | 'app' | 'auto';

/**
 * `Markdoc.Tokenizer` に渡すオプション (`slots` のみ `Markdoc.parse` に渡す)。
 * 値は `JSON.stringify` で生成モジュールに埋め込むため、JSON で表せない値はプラグイン生成時にエラーにする。
 */
export type MarkdocTokenizerOptions = NonNullable<ConstructorParameters<typeof Markdoc.Tokenizer>[0]> & {
  slots?: boolean;
};

export interface MarkdocVitePluginOptions {
  /** Markdoc スキーマフォルダのパス (プロジェクトルート相対)。既定値: `./markdoc` (`''` も同じ)。 */
  schemaPath?: string;
  /** Pages Router のデータ取得関数。`'static'` → getStaticProps、`'server'` → getServerSideProps。既定値: `'static'`。 */
  mode?: 'static' | 'server';
  /** 変換対象の拡張子。先頭のドットは省略可、大文字小文字を区別しない。既定値: `['.md', '.mdoc']`。 */
  extensions?: string[];
  /** `extensions` の代わりに使う正規表現 (@markdoc/next.js 互換)。指定時は `extensions` より優先する。 */
  extension?: RegExp;
  /**
   * `{% partial file="…" /%}` で読み込める拡張子。既定値: `['.md', '.mdoc']`。
   * 公式ローダーは任意のファイルを読むが、`.env` や鍵ファイル等を読み込ませないよう制限する。
   */
  partialExtensions?: string[];
  /**
   * Tokenizer / parse のオプション (公式ローダーの `options` と同じ)。既定値: `{allowComments: true}`。
   * `slots` は `Markdoc.parse` に、残りは `Markdoc.Tokenizer` に渡す。
   */
  options?: MarkdocTokenizerOptions;
  /**
   * `options` の別名。公式ドキュメントは `tokenizerOptions` と記載しているが、公式ローダーが読むのは `options`。
   * 両方指定時は `options` を優先する。
   */
  tokenizerOptions?: MarkdocTokenizerOptions;
  /**
   * App Router のページから export する `frontmatter.nextjs` のキー。
   * 有効な JS 識別子で、生成モジュールの既存の名前と重ならないこと。既定値: `['metadata', 'revalidate']`。
   */
  nextjsExports?: string[];
  /**
   * ページ (`appDir` / `pagesDir` 配下のファイル) の export 形式。
   * どちらの配下でもないファイルは、この値に関係なくページ以外のコンポーネントとして扱う。
   * - `'auto'` (既定値): `appDir` 配下は App Router 形式、`pagesDir` 配下は Pages Router 形式。
   * - `'app'` / `'pages'`: すべてのページをその形式にする。
   */
  router?: MarkdocRouter;
  /** プロジェクトルート (公式ローダーの `dir`)。既定値: Vite の `config.root`。 */
  dir?: string;
  /**
   * App Router のディレクトリ (絶対パスまたはルート相対)。
   * 省略時は `<root>/app` と `<root>/src/app` の両方を App Router のディレクトリとする。
   */
  appDir?: string;
  /**
   * Pages Router のディレクトリ (絶対パスまたはルート相対)。
   * 省略時は `<root>/pages` と `<root>/src/pages` の両方を Pages Router のディレクトリとする。
   */
  pagesDir?: string;
  /**
   * `Markdoc.transform` の実行タイミング。
   * - `'runtime'` (既定値): 公式互換。ソースと partial をモジュールに埋め込み、全環境で実行時に parse / transform する。
   * - `'build'`: ビルド時 / dev の変換時に transform する。client モジュールには JSON の renderable tree、
   *   `Markdoc.renderers.react`、スキーマモジュールの import のみ含める (パーサ、js-yaml、ソース、partial は含めない)。
   *   server モジュールは Pages の `mode: 'server'` の場合のみ、`context.variables` を使えるよう実行時に transform する。
   */
  compile?: 'runtime' | 'build';
  /**
   * React Fast Refresh への対応。コンポーネントを `<file>?markdoc-component` モジュール
   * (default export のみ、self-accepting) に分離する。ページモジュールは `markdoc` / データ取得関数 /
   * `nextjsExports` を持ち、コンポーネントを default として再 export する。既定値: `false`。
   */
  fastRefresh?: boolean;
}

export type MarkdocNextJsPageProps = {
  markdoc?: {
    content: import('@markdoc/markdoc').RenderableTreeNode | null;
    frontmatter: Record<string, unknown>;
    file: {
      path: string | undefined;
    };
  };
  // biome-ignore lint/suspicious/noExplicitAny: props の型が異なる任意のコンポーネントを受け取る。
  components?: Record<string, import('react').ComponentType<any>>;
};

export type TransformMarkdocContext = {
  resourcePath: string;
  root: string;
  options: MarkdocVitePluginOptions;
  /**
   * ファイルシステム探索の前に試すリゾルバ (Vite の `this.resolve` 等)。
   * `(contextDir, request)` を受け取り、絶対パスまたは null を返す。スキーマフォルダ外の結果は無視する。
   */
  resolve?: (contextDir: string, request: string) => Promise<string | null>;
  /**
   * 監視対象のスキーマ / partial ファイルごとに呼ぶ。存在しない partial も含め発見時点で呼ぶため、
   * 後からファイルを作成すると再変換される。
   */
  addWatchFile?: (file: string) => void;
  /** Vite environment の consumer。`compile: 'build'` でのみ使う。既定値: `'client'`。 */
  consumer?: 'client' | 'server';
  /**
   * `compile: 'build'` で解決済みのスキーマモジュールを import する。既定値: ネイティブの `import()`。
   * プラグインは TS / TSX を扱うため Vite の `runnerImport` を使う。
   */
  importModule?: (file: string) => Promise<SchemaModule>;
  /** 存在しないスキーマのエントリの候補パスも監視する。`build --watch` で後から作成されたエントリを検出する。 */
  watchMissingSchemaEntries?: boolean;
  /**
   * スキーマフォルダがプロジェクトルート、ファイルシステムのルート、ホームディレクトリのいずれかを含む。
   * スキーマフォルダ自体と存在しないエントリの候補パスを監視しない (フォルダ全体を再帰的に監視させない)。
   */
  narrowSchemaWatch?: boolean;
  /** スキーマ解決 / partial の読み込み / スキーマモジュールの共有キャッシュ (createMarkdocCache 参照)。 */
  cache?: MarkdocCache;
};

/** import したスキーマモジュールと、その評価時に読み込まれたファイル。 */
export type SchemaModule = {
  module: Record<string, unknown>;
  dependencies: string[];
};

export type MarkdocCache = {
  /** `${schemaDir}\0${entry}` → 解決したパス (存在しない場合は null)。 */
  schemaEntries: Map<string, string | null>;
  /** partial の実パス → 内容。パスの検査は読み込みのたびに行う。 */
  partials: Map<string, string>;
  /** スキーマモジュールのパス → import 結果 (compile: 'build')。失敗した import は保持しない。 */
  schemaModules: Map<string, Promise<SchemaModule>>;
  /** スキーマモジュールが読み込んだファイル。変更時にキャッシュを消去する。消去後も保持する。 */
  deps: Set<string>;
  /** 消去のたびに増える。読み込み中に消去された partial の内容を書き戻さないために使う。 */
  generation: number;
};

export type SourceMapV3 = {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
};

export type TransformMarkdocResult = {
  code: string;
  /** compile: 'build' の client モジュールでは `{mappings: ''}` (Rollup でマップなし) にし、.map ファイルに Markdown を含めない。 */
  map: SourceMapV3 | {mappings: ''};
  /** 解決・参照したスキーマモジュールと partial の絶対パス。 */
  watchFiles: string[];
  meta: {
    isPage: boolean;
    appMode: boolean;
    filepath: string | undefined;
    schemaDir: string;
  };
};
