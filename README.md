# markdoc-vinext-plugin

[Vinext](https://github.com/cloudflare/vinext)（Cloudflare による Vite ベースの Next.js 実装）で、Markdoc の `.md` / `.mdoc` を React コンポーネントとして扱うための Vite プラグインです。

公式の [`@markdoc/next.js`](https://github.com/markdoc/next.js) は webpack / Turbopack のローダー（`src/loader.js`）なので、Vite 上で動く Vinext では使えません。このプラグインは、公式ローダーが生成するモジュールと実行時の振る舞い（`src/runtime.js` を含む）を Vite の `transform` フックで再現します。対象は `@markdoc/next.js` 0.5.x〜0.6.x 相当の `main` ブランチです。

## 目次

- [依存関係](#依存関係)
- [開発](#開発)
- [使い方](#使い方)
- [オプション](#オプション)
- [スキーマフォルダ](#スキーマフォルダ)
- [`compile: 'build'`](#compile-build)
- [Vite との連携](#vite-との連携)
- [HMR と Fast Refresh](#hmr-と-fast-refresh)
- [MDX との併用](#mdx-との併用)
- [公式 `@markdoc/next.js` との違い](#公式-markdocnextjs-との違い)
- [生成コード](#生成コード)
- [検証](#検証)
- [制限事項](#制限事項)
- [ファイル構成](#ファイル構成)

## 依存関係

実行時に必要なパッケージ:

| パッケージ | 用途 |
| --- | --- |
| `@markdoc/markdoc` | パース、変換、`renderers.react` |
| `js-yaml` | frontmatter の YAML 読み込み（公式と同じ） |
| `react` | 生成モジュールが import する |
| `vite` | プラグイン API（`>=6`） |

Vinext プロジェクトでは、これに加えて `vinext` と、App Router を使う場合は `@vitejs/plugin-rsc` / `react-server-dom-webpack` が必要です。プラグイン自体は `vinext` に依存しません。

## 開発

パッケージ管理とスクリプトの実行には [Bun](https://bun.com/) を使います。

```sh
bun install
bun run typecheck         # bun check（tsconfig.json に従って型チェック）
bun run biome             # Biome でリントとフォーマット（自動修正あり）
bun run verify            # typecheck、test:unit、test:integration を続けて実行
bun run test:unit         # bun test test/unit test/golden（Vite を起動しない）
bun run test:integration  # bun test test/integration（Vite の build / dev サーバを使う。timeout 120 秒）
bun run versions          # 検証に使った依存パッケージと Bun のバージョンを表示
```

テストの作業ファイルは `tmp/test/<テストファイル名から .test.ts を除いた名前>/` に出力します。

`bunfig.toml` では、インストール時の安全対策として次の 3 つを設定しています。

| 設定 | 内容 |
| --- | --- |
| `install.minimumReleaseAge = 259200` | 公開から 3 日（259200 秒）以上経過したバージョンだけをインストールする（[bunfig](https://bun.com/docs/runtime/bunfig#install-minimumreleaseage)） |
| `install.registry = "https://npm.flatt.tech/"` | GMO Flatt Security の [Takumi Guard](https://shisho.dev/docs/t/guard/quickstart/npm.md) レジストリ。トークンなしの匿名利用で、悪性パッケージのブロックが有効 |
| `install.security.scanner` | Socket Security の [Bun スキャナ](https://github.com/SocketDev/bun-security-scanner)。トークンなしの無料 public API モード |

`minimumReleaseAge` と `install.security.scanner` には Bun 1.3 以降が必要です。

Biome は TypeScript / JavaScript / JSON を対象にします。Markdown（`.md` / `.mdoc`）は対象外です。Biome の Markdown 整形は Markdoc の frontmatter とタグを壊すためです。

## 使い方

### 1. `vite.config.ts` にプラグインを追加する

`markdoc()` は `vinext()` より前に置きます。プラグインは `enforce: 'pre'` で、JSX / RSC の処理より先に `.md` / `.mdoc` を JavaScript に変換します。

```ts
import {defineConfig} from 'vite';
import vinext from 'vinext';
import {markdoc} from 'markdoc-vinext-plugin';

export default defineConfig({
  plugins: [
    markdoc({
      schemaPath: './markdoc',
      mode: 'static',
      extensions: ['.md', '.mdoc'],
      router: 'auto',
    }),
    vinext(),
  ],
});
```

`examples/basic/vite.config.ts` は、`vinext` がなくても型チェックできるよう `vinext()` をコメントアウトした例です。

### 2. `next.config.js` で `pageExtensions` を設定する

ルートとして認識させるため、`pageExtensions` に `md` と `mdoc` を加えます。変換は Vite プラグインが行うので、公式の `withMarkdoc()` は使いません。

```js
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdoc'],
};

export default nextConfig;
```

### 3. TypeScript の型（任意）

`import Note from './note.md'` の型エラー（TS2307）を防ぐため、同梱の型宣言（`src/env.d.ts`）を読み込みます。

```ts
// アプリ側の env.d.ts など
/// <reference types="markdoc-vinext-plugin/env" />
```

`default`（コンポーネント）、`markdoc`、`metadata`、`revalidate`、`getStaticProps`、`getServerSideProps` を宣言しています。実際にどれが export されるかはファイルの場所で決まるため、型では区別していません。`nextjsExports` で追加した名前は宣言していません。

### Pages Router

`pages/`（または `src/pages/`）の下に `.md` を置きます。ここでの `pages/` はプロジェクトルート直下、または `pagesDir` で指定したディレクトリです。

```text
pages/
  docs/
    getting-started.md
```

`mode: 'static'`（既定）なら `getStaticProps`、`mode: 'server'` なら `getServerSideProps` を生成し、公式と同じ形の props を返します。

```ts
{
  props: {
    markdoc: {
      content,       // Markdoc.transform の結果（JSON 化済み）
      frontmatter,   // YAML frontmatter（JSON 化済み）
      file: {path},  // router のディレクトリからの相対パス（例: `/docs/getting-started.md`）
    },
  },
}
```

default export のコンポーネントは `props.markdoc` を受け取り、`Markdoc.renderers.react` で描画します。`_app` から `props.components` を渡すと、コンポーネントを上書きできます（公式と同じ）。

frontmatter は `export const markdoc = {frontmatter}` でも export され、本文中では `$markdoc.frontmatter` で参照できます。

```md
---
title: Get started with Markdoc
---

# {% $markdoc.frontmatter.title %}
```

サンプル: `examples/basic/pages/docs/getting-started.md`

### App Router

`app/`（または `src/app/`）の下に、例えば `app/docs/page.md` を置きます。`app/` はプロジェクトルート直下、または `appDir` で指定したディレクトリです。

公式ローダーと同じく、次のように生成します。

- `getStaticProps` / `getServerSideProps` は生成しません。
- default export は `async` 関数で、内部で `await getMarkdocData()` します。
- `frontmatter.nextjs` から次の値を export します（公式は `metadata` / `revalidate` 固定です。このプラグインは `nextjsExports` で変更できます）。

```ts
export const metadata = frontmatter.nextjs?.metadata;
export const revalidate = frontmatter.nextjs?.revalidate;
```

frontmatter の書き方:

```md
---
title: ページタイトル
nextjs:
  metadata:
    title: ページタイトル
    description: 説明
  revalidate: 60
---
```

`metadata` は frontmatter のトップレベルではなく `nextjs` の下に置きます。公式ローダーも `frontmatter.nextjs?.metadata` を参照します。

frontmatter がオブジェクト以外（スカラー、`null`、`~`）の場合は `{}` として扱います（公式では `frontmatter.nextjs` の参照で例外になります）。配列はそのまま返します。YAML の構文エラーは、変換時（ビルド時や dev のリクエスト時）にファイル名付きで報告します。

サンプル: `examples/basic/app/docs/page.md`

### ページ以外の import

`app/` にも `pages/` にも属さない `.md` は、公式の「コンポーネントとしての import」と同じく扱います。

- データ取得関数や `metadata` は export しません。
- `getMarkdocData()` を同期的に呼び、`file.path` は `undefined` です。

```ts
import Note from '../components/note.md';
```

サンプル: `examples/basic/components/note.md`

### frontmatter の扱い

- `$$mdtype` というキーは、すべての階層で取り除きます。`$$mdtype: Tag` を持つオブジェクトはレンダラーが Markdoc のタグとして描画するため、本文を書ける人が任意の要素や `dangerouslySetInnerHTML` を出力できてしまいます。Markdoc のタグ構文も、変数のオブジェクトから同じキーを取り除きます。公式ローダーは取り除きません。
- 値の数は、YAML のエイリアスを展開した後で 100,000 個までです。`!!binary` などの型付き配列は要素数も数えます。超えると変換時にエラーにします。自身を参照するエイリアス（`a: &x [*x]`）もエラーにします。
- `export const markdoc` の `frontmatter` は、YAML の日付を `Date` のまま保持します（`compile` の設定によらず同じ）。`!!binary` の値はバイトの数値の配列になります。`getStaticProps` などが返す `props.markdoc.frontmatter` は JSON 化済みなので、日付は文字列です。

## オプション

| オプション | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `schemaPath` | `string` | `'./markdoc'` | スキーマフォルダ（プロジェクトルートからの相対パス）。`''` は既定値として扱います。指定したパスが存在しなければエラー、既定のパスが存在しなければ空のスキーマで続行します。既定値かどうかは文字列の完全一致で判定します（`'markdoc'` は指定したパスとして扱います）。ルートの外を指す場合は `server.fs.allow` に自動で追加します（[Vite との連携](#vite-との連携)）。 |
| `mode` | `'static' \| 'server'` | `'static'` | Pages Router で `getStaticProps` と `getServerSideProps` のどちらを生成するか。 |
| `extensions` | `string[]` | `['.md', '.mdoc']` | 変換対象の拡張子。先頭のドットは省略可能で、大文字小文字を区別しません。 |
| `extension` | `RegExp` | なし | 公式互換の正規表現。指定すると `extensions` より優先します（両方指定すると警告）。`/g` / `/y` 付きでも毎回 `lastIndex` をリセットします。 |
| `partialExtensions` | `string[]` | `['.md', '.mdoc']` | `{% partial file="…" /%}` で読み込めるファイルの拡張子。このプラグイン独自のオプションです（公式は制限なし）。 |
| `options` | `{slots?, allowComments?, ...}` | `{allowComments: true}` | 公式ローダーの `options`。`slots` は `Markdoc.parse` に、残りは `Markdoc.Tokenizer` に渡します。`slots` は boolean のみ受け付けます。値が `undefined` のキーは指定なしとして扱います。オブジェクト以外（`null`、配列、プリミティブ）はエラーにします。生成コードに `JSON.stringify` で埋め込むため、JSON で表せない値（入れ子を含む関数、RegExp、入れ子の `undefined`、`NaN` / `Infinity`、BigInt、クラスのインスタンス、getter、疎な配列、循環参照、Symbol キー）はプラグイン生成時にエラーにします。 |
| `tokenizerOptions` | 同上 | なし | `options` の別名（公式ドキュメントの表記）。両方ある場合は `options` を優先します。 |
| `nextjsExports` | `string[]` | `['metadata', 'revalidate']` | App Router のページで `frontmatter.nextjs` から export するキー。JavaScript の識別子であること、予約語・生成コード内の名前（`default`、`markdoc`、`source`、`frontmatter` など）・`Object.prototype` のプロパティ名（`constructor` など）・他の指定値と重ならないことを、プラグイン生成時に検証します。 |
| `router` | `'pages' \| 'app' \| 'auto'` | `'auto'` | ページと判定したファイルの出力形式。`'auto'` は `appDir` の下なら App Router、`pagesDir` の下なら Pages Router の形式です。`'app'` / `'pages'` はすべてのページをその形式にします。ページ以外のファイルには影響しません。 |
| `dir` | `string` | Vite の `config.root` | プロジェクトルート（公式の `dir`）。 |
| `appDir` | `string` | `<root>/app` と `<root>/src/app` | App Router のディレクトリ（絶対パスまたはルートからの相対パス）。指定すると既定の候補は使いません。 |
| `pagesDir` | `string` | `<root>/pages` と `<root>/src/pages` | Pages Router のディレクトリ。`appDir` と同様です。 |
| `compile` | `'runtime' \| 'build'` | `'runtime'` | `Markdoc.transform` を実行するタイミング。`'runtime'` は公式互換で、ソースと partial をモジュールに埋め込み、実行時に parse / transform します。`'build'` は変換時に transform し、結果のツリーだけを埋め込みます（[`compile: 'build'`](#compile-build)）。 |
| `fastRefresh` | `boolean` | `false` | React Fast Refresh のため、コンポーネントを `<file>?markdoc-component` モジュールに分けます。`false` の場合、export の形は公式と同じです（[HMR と Fast Refresh](#hmr-と-fast-refresh)）。 |

### ページの判定

1. `appDir` / `pagesDir`（未指定なら `<root>/app`、`<root>/src/app`、`<root>/pages`、`<root>/src/pages`）の下にあるファイルだけをページとします。絶対パスの途中にある `app/` や `pages/` は見ないため、Docker の `WORKDIR /app`、`pages` という名前のリポジトリ、`content/pages/` などでも誤判定しません。
2. 両方のディレクトリに含まれる（入れ子の）場合は、深いほうを優先します。
3. `file.path` は、そのディレクトリからの相対パスです（例: `/docs/page.md`）。
4. どちらにも含まれないファイルは、コンポーネントとしての import として扱います。
5. プロジェクトルートがシンボリックリンクやジャンクション経由の場合は、そのパスと実パスの両方で判定します（`resolve.preserveSymlinks` の設定によらずページになります）。`schemaPath` などの相対パスは、実パスではなく指定どおりのルートから解決します。

## スキーマフォルダ

既定はプロジェクトルートの `./markdoc` です。`config` / `tags` / `nodes` / `functions` を、単一ファイルとディレクトリ + `index` のどちらでも解決します。拡張子は `.js` / `.jsx` / `.ts` / `.tsx` / `.mjs` / `.cjs` / `.mts` / `.cts` / `.json` です。存在しないエントリは空のオブジェクトになります。

```text
markdoc/
  config.ts          # または config.js / config/index.ts
  tags.ts            # または tags/index.ts
  nodes.ts
  functions.ts
  components/
    Callout.tsx
  partials/
    footer.md        # {% partial file="footer.md" /%} で読み込む
```

解決にはスキーマフォルダからの相対指定（`./config` など）だけを使います。Vite の `this.resolve` を先に試し、解決できなければファイルシステムを探します。スキーマフォルダの外に解決された結果（エイリアスなど）は使いません。bare 指定子は試さないので、`node_modules` にある `config` や `tags` という名前のパッケージを誤って読み込むことはありません。

各モジュールは生成コードから `import * as tags from '...'` の形で読み込まれ、Vite が TypeScript を変換します。`defaultObject` の規則は公式の `runtime.js` と同じです。

- `export default` があればそれを使います。
- なければ named export の集合を使います。

kebab-case のタグ名は default export で定義してください。

```ts
// markdoc/tags.ts
import {Callout} from './components/Callout';

export default {
  callout: {
    render: Callout,
    attributes: {
      type: {type: String, default: 'info'},
    },
  },
};
```

`config` は最後に展開されるので、tags / nodes / functions の上書きや `variables` の追加に使えます。`partials` と `source` はプラグインが設定するため、`config` では指定できません。サンプルの `markdoc/config.ts` は `variables.product` を定義しています。

### partial

`{% partial %}` で参照された partial を、入れ子の参照も含めて `markdoc/partials/` から読み込みます。公式との違い:

- `file` は `markdoc/partials/` の中に解決される必要があります（`../../.env` や絶対パスは拒否）。シンボリックリンクは実体のパスと拡張子も検査します。
- 拡張子は `partialExtensions`（既定は `.md` / `.mdoc`）に限ります。
- Windows では、`file` の解決結果に `:` が含まれると拒否します（NTFS の代替データストリーム `a.txt:s.md` で拡張子の検査を回避できるため）。
- `file` がディレクトリなど読み込めないものを指す場合は、内容を含まない `Partial "…" in <参照元> could not be read (EISDIR).` というエラーにします。
- 循環参照（A → B → A、自己参照）はエラーにします。ネストは 32 段までです。公式では循環すると無限再帰します。検査の対象は `file` が文字列リテラルの参照だけで、`file=$name` のような変数の参照は Markdoc の変換時に解決されます。
- 存在しない partial は、参照元のファイル名付きのエラーにします。dev ではそのパスを監視するので、後からファイルを作ると再変換されます。ただし、root やホームディレクトリを含むスキーマフォルダでは、起動時に `partials` フォルダがなければ（または後で削除して作り直した場合は）監視されないため、再起動が必要です（[Vite との連携](#vite-との連携)）。
- 同じ partial を複数の場所から参照する（ダイヤモンド型）ことはできます。

### クライアントに配信される内容

既定の `compile: 'runtime'` では、公式と同じく Markdown のソース全文と partial の全文が文字列として生成モジュールに入り、クライアントのバンドルにも含まれます（Pages Router のクライアント側モジュールや、ページ以外の import）。`allowComments: true` は描画結果から HTML コメントを除くだけなので、`<!-- メモ -->` もソース文字列には残ります。公開したくない内容は Markdown に書かないでください。

`compile: 'build'` では、クライアント向けモジュールにソース、partial、パーサ、js-yaml は入りません。ただし、描画される本文、`frontmatter` 全体（`export const markdoc`）、スキーマモジュール（`config.ts` の `variables` など）はどちらのモードでもクライアントに届きます。また、dev サーバではルート配下の `.md` 自体を `?raw` で読めます（Vite の仕様）。

## `compile: 'build'`

```ts
markdoc({compile: 'build'});
```

Vite の Environment API（`this.environment.config.consumer`）で client と server（ssr / rsc）を区別します。

| 出力先 | ページの種類 | 生成するもの |
| --- | --- | --- |
| client | すべて | transform 済みの renderable tree（JSON）、同梱の `Markdoc.renderers.react` のコピー、スキーマの import（描画コンポーネントのため）。パーサ、Tokenizer、js-yaml、Markdown のソース、partial のテキストは含みません。 |
| server | Pages の `mode: 'server'` | 既定と同じく実行時に parse / transform します。`getServerSideProps(context)` の `context.variables` が使えます。 |
| server | それ以外 | client と同じ transform 済みのツリー（`@markdoc/markdoc` の import は残ります）。 |

注意点:

- export の名前と形（`default`、`markdoc`、`getStaticProps` / `getServerSideProps`、`metadata` / `revalidate` など）は変わりません。
- 変数、関数、partial、`{% if %}` は変換時に評価されます。`getStaticProps(context)` などに渡した `context.variables` は反映されません。リクエスト時の変数が必要な場合は、Pages Router の `mode: 'server'` を使ってください（server 側は実行時に変換します）。
- スキーマ（`config` / `tags` / `nodes` / `functions`）は変換時にも実行します。Vite 6.1 以降の `runnerImport`（実験的 API）で、`schemaPath` 配下に解決されたファイルだけを読み込みます。Vite 6.0 ではネイティブの `import()` を使うため、TSX と拡張子なしの import を含むスキーマは読めず、スキーマの編集は dev サーバを再起動するまで反映されません。TSX のスキーマで `compile: 'build'` を使う場合は Vite 6.1 以降が必要です。
- `@markdoc/markdoc` は tree-shaking が効かず、`renderers` だけを import しても markdown-it を含む約 140 KB が残ります。そのためクライアント用に公式の React レンダラー（約 30 行）をコピーして同梱しています。テストで公式と同じ HTML になることを確認しています。

サンプルの Pages ページのバンドルサイズ（React を external にして esbuild で minify）:

| 構成 | バイト数 |
| --- | --- |
| `compile: 'runtime'`（Pages client） | 208,997 |
| `compile: 'build'`（Pages client） | 3,715 |
| `compile: 'build'`（App client） | 4,276 |
| `compile: 'build'`（App server） | 3,614 |

## Vite との連携

- **`optimizeDeps.include`**: `@markdoc/markdoc` と `js-yaml` を追加します。ユーザーの指定は残し、重複は追加しません。
- **`server.fs.allow`**: `schemaPath` が Vite の root の外にある場合、そのディレクトリを追加します。シンボリックリンク（ジャンクション）経由で実体が root の外にある場合は、実パスも追加します。ユーザーが `fs.allow` を指定していなければ、Vite の既定値（`searchForWorkspaceRoot(root)`）も一緒に追加するので、既定の許可範囲は維持されます。指定したパスと実パスのどちらかが次に当たる場合は、無関係なファイルまで公開することになるため追加せず、警告を出します。追加したディレクトリ内のファイルは dev サーバの `/@fs/` で読めるようになります（`server.fs.deny` は有効なままです）。
  - `schemaPath` が root を含むディレクトリ（`'..'` や `'/'`）
  - ファイルシステムのルート（`E:\` など）
  - ホームディレクトリを含むディレクトリ

  これらの場合（`schemaPath` が root そのものの場合を含む）、スキーマフォルダは再帰的に監視しません。dev サーバの監視に加えるのは既存の `partials` フォルダだけで、スキーマのファイルとして扱うのは `partials` 内のファイルと `config` / `tags` / `nodes` / `functions` の候補パスだけです。root の外に `config` などのファイルや `partials` フォルダを新しく作った場合（`partials` フォルダを削除して作り直した場合を含む）は、dev サーバ（または `build --watch`）を再起動してください。なお、`partials` フォルダの実パスが root、ホームディレクトリ、ファイルシステムのルートのいずれかを含む場合は、このモードに限らず `partials` フォルダを監視せず、警告を表示します。
- **フックのフィルタ**: `transform` / `resolveId` / `load` は Vite 6.3 以降の `{filter, handler}` 形式です。フィルタに対応しない Vite でも動くよう、ハンドラ内でも判定します。
- **遅延 import**: プラグインのモジュールは `@markdoc/markdoc` / `js-yaml` を型としてのみ import し、最初の変換時に動的 `import()` します。
- **キャッシュ**: スキーマのエントリの解決結果、partial の内容、`compile: 'build'` で読み込んだスキーマモジュールをメモリに保持します。
  - partial を編集すると、partial のキャッシュだけを破棄します。
  - スキーマフォルダ内の他のファイル（root などを含むスキーマフォルダでは `config` / `tags` / `nodes` / `functions` の候補パスのみ）、またはスキーマモジュールが読み込んだファイルが変わると、すべて破棄します。
  - import に失敗したスキーマモジュールは保持しないので、原因のファイルを直すと次の変換で読み込み直します。
  - partial のパス検査はキャッシュ時も毎回行います。
- **`build --watch`**: 存在しないスキーマのエントリ（`config.ts` など）の候補パスとスキーマフォルダを監視するので、後から作成すると再ビルドされます。root やホームディレクトリを含むスキーマフォルダでは、どちらも監視しないため、エントリを作成した後は再起動してください。
- **ソースマップ**: Markdown ファイルを `sources`、元の Markdown を `sourcesContent` とするマップを返します。生成コードの各行を `.md` の 1 行目に対応させる簡易版で、スタックトレースに `.md` のファイル名が出ます。`compile: 'build'` の client モジュールと Fast Refresh のコンポーネントモジュールは、Rollup の「マップなし」形式（`{mappings: ''}`）を返します。`.md` をソースにすると、`build.sourcemap` の `.map` に Rollup が Markdown をそのまま埋め込むためです。

## HMR と Fast Refresh

- 変換対象の `.md` / `.mdoc` は、Vite の通常のファイル監視で更新されます。
- 読み込んだ partial と、解決できたスキーマのエントリは `this.addWatchFile` で監視します。partial を編集すると、参照しているページが再変換されます。
- `compile: 'runtime'` では、スキーマモジュールは生成コードが import するので、通常の import グラフで更新が伝わります。
- `compile: 'build'` では、スキーマモジュールとそれが読み込んだファイルの編集時に Markdoc のモジュールを無効化し、再変換させます。スキーマを変換時に評価しているためです。
- `hotUpdate`: ファイルの編集は Vite の通常の伝播に任せます。スキーマフォルダ内でファイルが追加・削除されたときだけ（`config` などの解決結果が変わるため）、Markdoc のモジュールを無効化して `full-reload` を送ります。root などを含むスキーマフォルダでは、`partials` 内のファイルと `config` / `tags` / `nodes` / `functions` の候補パスだけが対象で、それ以外のファイルは Vite の既定の処理に任せます。
- `server.hmr: false` のときやディレクトリの追加・削除は `hotUpdate` に届かないため、dev サーバの watcher でもモジュールを無効化し、ディレクトリの場合はすべての environment に `full-reload` を送ります。
- 存在しない partial を参照してエラーになったページは、その partial を作ると再起動なしで回復します。root やホームディレクトリを含むスキーマフォルダでは、起動時から存在する `partials` フォルダ内に作った場合に限ります。

### Fast Refresh（`fastRefresh: true`）

既定（`false`）では、`.md` モジュールはコンポーネント以外（`markdoc`、`getStaticProps`）も export するため、Fast Refresh の境界になりません。変更は親への伝播か full reload になります。

`fastRefresh: true` にすると、1 つの `.md` から 2 つのモジュールを生成します。

- **ページモジュール**（`foo.md`）: `markdoc`、`getStaticProps` / `getServerSideProps`、`metadata` / `revalidate` などを `fastRefresh: false` と同じく export し、default は `export {default} from './foo.md?markdoc-component'` で再 export します。Vinext から見たページの形は変わりません。
- **コンポーネントモジュール**（`foo.md?markdoc-component`）: default export のコンポーネントだけを持ちます。描画に必要なデータは `foo.md` から読みます（循環 import ですが、参照は描画時だけです）。

どちらのモジュールも self-accept するので、`.md` を編集するとクライアントには `full-reload` ではなく `update` が送られます。partial やスキーマ、スキーマが import するファイルを編集した場合も、import 元を辿って見つかった `.md` の両方のモジュールを更新対象にします。辿るのは self-accept しないモジュールまでです。状態を保ったままコンポーネントを差し替えるには、`@vitejs/plugin-react` の `include` に `.md` / `.mdoc` を加えてください。クエリ付きの id にも一致させる必要があります。`vinext()` は `@vitejs/plugin-react` を自動で登録し、重複するとエラーにするため、`vinext({react: false})` にして自分で登録します。

```ts
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    markdoc({fastRefresh: true}),
    react({include: /\.(?:[tj]sx?|md|mdoc)(?:\?.*)?$/}),
    vinext({react: false}),
  ],
});
```

コンポーネントモジュールは `react/jsx-runtime` の `jsx()` を使います。`@vitejs/plugin-react` は、コードに `react/jsx-runtime` が含まれるかどうかで Fast Refresh を適用するためです。

注意:

- `@vitejs/plugin-react` の `include` を設定しないまま `fastRefresh: true` にすると、編集が受け入れられても再描画されず、手動でリロードするまで古い表示のままになります。
- Pages Router の本文は `props.markdoc`（`getStaticProps` の結果）から来るため、本文の変更が反映されるかはフレームワークが dev で props を再取得するかどうかによります。
- App Router のページは Server Component なので、クライアントの Fast Refresh の対象外です。

## MDX との併用

- Vinext の `vinext:mdx` は `.mdx` だけを対象にするため、このプラグインの `.md` / `.mdoc` とは衝突しません。
- `@mdx-js/rollup` を手動で追加する場合、既定で `.md` も変換対象になります（`mdExtensions` の既定値に `.md` を含むため）。`extension` オプションはありません。`include` で `.mdx` だけに絞ってください。

```ts
import mdx from '@mdx-js/rollup';

mdx({include: /\.mdx$/});
```

プラグインの順序は `markdoc()` →（必要なら MDX）→ `vinext()` にします。

## 公式 `@markdoc/next.js` との違い

| 項目 | 公式 | このプラグイン |
| --- | --- | --- |
| ページの判定 | `appDir` / `pagesDir` の前方一致。`appDir` があれば全ページを App Router の形式にする | `appDir` / `pagesDir`（既定は `<root>/{,src/}{app,pages}`）の下だけ。ファイルごとに形式を決める |
| `file.path` | `split('app' \| 'pages')[1]` | router のディレクトリからの相対パス |
| 変換しないファイル | なし（`node_modules` 内の `.md` も変換） | `\0` で始まる仮想 id、`node_modules` 内、`?raw` / `?url` / `?inline` / `?worker` などの特殊なクエリ付き id。それ以外のクエリ（`?t=`、`?v=` など）は除去して変換する |
| 拡張子 | 正規表現（大文字小文字を区別） | `extensions` は大文字小文字を区別しない。`extension` 正規表現はそのまま使う |
| スキーマの解決 | `preferRelative: true`（相対を優先し、bare 指定子も試す） | 相対指定のみ。スキーマフォルダ外の結果は使わない |
| partial | パスの制限なし。循環すると無限再帰 | partials フォルダ内に限定。拡張子の制限あり。循環と深さ超過はエラー |
| frontmatter がオブジェクト以外 | `frontmatter.nextjs` の参照で例外 | オブジェクト以外（スカラー、`null`、`~`）は `{}`。配列はそのまま。YAML の構文エラーは変換時に報告 |
| frontmatter の `$$mdtype` | そのまま渡す（Markdoc のタグとして描画される） | 取り除く |
| `nextjsExports` | 検証なし | 識別子として検証 |
| スキーマの監視 | `addContextDependency(schemaDir)` | 使用したファイルを `addWatchFile`。スキーマフォルダでの追加・削除時に無効化 |
| Fast Refresh | babel loader 経由 | `fastRefresh: true` で対応 |
| runtime | `@markdoc/next.js/runtime` | 仮想モジュール `virtual:markdoc-vinext/runtime`（`src/runtime/runtime.js` の内容を文字列として返す）。`markdoc-vinext-plugin/runtime` は同じファイルの `getSchema` などを export し、`renderReact` は含まない |
| import | `import yaml from 'js-yaml'`、`import {renderers} from '@markdoc/markdoc'` | `import {load as yamlLoad} from 'js-yaml'`、`Markdoc.renderers.react`（js-yaml v5 と Vite 8 / Rolldown に対応するため） |
| ビルドツールの設定 | `withMarkdoc()` | Vite プラグイン |

## 生成コード

公式ローダーと同じく、出力は JSX を含まない JavaScript です（`React.createElement` は `Markdoc.renderers.react` の中で呼ばれます）。追加の JSX 変換は不要です。

生成コードに埋め込む値（ソース、`file.path`、partial、parse / tokenizer のオプション、スキーマの import パス、runtime の id）はすべて `JSON.stringify` で引用します。partial は `JSON.parse` で復元するので、`__proto__` のようなキーもそのまま残ります。

`getSchema` は、タグ / ノードの `render` 関数を PascalCase のコンポーネント名に置き換え、コンポーネント本体は描画時に渡します。公式と同じく、JSON への変換で関数が失われないようにするためです。

## 検証

### プラグイン単体

`bun test` で次の 3 種類のテストを実行します。Windows 11 / Bun 1.4.3 で、`bun run versions` が表示する次のバージョンを使って全 424 件の成功を確認しています。

`vite@6.4.5`、`@markdoc/markdoc@0.5.11`、`js-yaml@4.3.2`、`react@19.3.1`、`react-dom@19.3.1`、`typescript@5.9.3`

| 種類 | 場所 | 件数 | 内容 |
| --- | --- | --- | --- |
| unit | `test/unit/` | 319 | Vite を起動しない単体テスト |
| golden | `test/golden/` | 44 | `examples/basic/` のサンプルと境界ケースの生成コードのスナップショット |
| integration | `test/integration/` | 61 | Vite の build / dev サーバ / `resolveConfig` を使うテスト |

主な確認内容:

- Pages Router（`mode: 'static'` / `'server'`）、App Router、ページ以外の import の生成コード
- Vite でのバンドルと `react-dom/server` での描画（カスタムタグ、関数、変数、partial）
- id の判定（クエリ、大文字の拡張子、Windows 形式の id、`node_modules`）
- import パス（POSIX、Windows の同一ドライブと別ドライブ）
- ページの判定（Docker の `/app`、`content/pages/`、`src/app` / `src/pages`、ルート外）
- オプションの検証
- partial の安全性（パストラバーサル、拡張子、シンボリックリンク、ディレクトリ）、循環・深さ超過、ダイヤモンド型参照、存在しない partial
- スキーマの解決（`node_modules` にある同名のパッケージを読み込まないこと）
- frontmatter の境界ケース（BOM + CRLF、なし、空ファイル、スカラー、`~`、YAML 構文エラー）
- `src/runtime/runtime.js` と仮想モジュールが返す runtime の一致
- Vite の dev サーバでの HMR（partial の編集、スキーマの追加・削除、存在しない partial の作成）
- `config()`、フックのフィルタ、遅延 import、キャッシュ、`hotUpdate`
- `compile: 'build'` の生成コードとバンドルサイズ、同梱レンダラーと `Markdoc.renderers.react` の一致
- `fastRefresh: true` の出力、dev SSR と本番バンドルでの描画、HMR の `update`
- ソースマップ（`build.sourcemap` の `.map` に Markdown が入らないこと）
- 依存の向き（`vite`、`@markdoc/markdoc`、`js-yaml` を import するモジュールの制限）

型宣言（`src/env.d.ts`）は、`test/types/usage.ts` を `bun run typecheck` で型チェックして確認しています。

### Vinext

`vinext@1.4.4`、`vite@8.3.6`（Rolldown）、`@vitejs/plugin-rsc@0.5.39`、`@vitejs/plugin-react@6.3.0`、`@markdoc/markdoc@0.5.12`、`js-yaml@5.5.0`、`react@19.3.1` の Pages Router / App Router のプロジェクトで確認しています。

- **本番**（`vite build` + `vinext start`）: 両ルーターでビルドに成功し、ページが 200 を返します。HTML にカスタムタグ、関数、変数、partial が含まれます。App Router では `<title>` と description の meta が出力され、2 回目以降のリクエスト（キャッシュのヒット時）の `cache-control` が `s-maxage=60, stale-while-revalidate=31535940`（frontmatter の `revalidate: 60` と一致）になります。
- **開発**（`vite dev`）: 両ルーターでページが 200 を返します。`.md` と partial を編集すると、Pages Router は `page reload`、App Router は RSC の `hmr update` で更新されます。
- **`fastRefresh: true`**（Pages Router、`vinext({react: false})` と `@vitejs/plugin-react`）: ビルド、`vinext start`、`vite dev` でページが 200 を返し、`.md` の編集でクライアントに両方のモジュールの `hmr update` が送られます。
- **frontmatter の `$$mdtype`**: 取り除かれ、ビルドと dev のどちらでも HTML に要素として出力されません。
- **`compile: 'build'`**（Pages Router の本番）: パーサを含むチャンク（約 204 KB）がなくなり、ページのチャンクは約 2.4 KB になります。

Vinext 1.4.4 では `vinext dev` ではなく `vite dev` を使ってください。

## 制限事項

- **未確認の項目**: ブラウザでの Fast Refresh の状態保持、Vinext の App Router での `fastRefresh: true`、Vinext 上でのスキーマファイルの追加・削除による HMR、クライアントのハイドレーション、Pages Router と App Router の混在、Cloudflare Workers へのデプロイ、ISR の実際の再生成、Vite 6.3 未満でのフックのフィルタ、Vite 6.0 での `runnerImport` のフォールバック、Vite 6.0 で TSX を含まないスキーマの `compile: 'build'`。
- **Next.js の組み込みタグ**: 公式の `@markdoc/next.js/tags`（`head` / `link` / `script` / `image` / `comment`）は同梱していません。必要なら公式パッケージから import し、`markdoc/tags` で再 export してください。
- **スキーマのエイリアス**: スキーマのエントリは相対指定だけで解決するため、エイリアスでスキーマフォルダの外を指すことはできません。
- **スキーマの依存ファイルの import 失敗**: `compile: 'build'` で、スキーマモジュールが import するファイルの読み込みに失敗すると、依存ファイルが分からないため、代わりにスキーマフォルダを監視します（root やホームディレクトリを含むスキーマフォルダでは監視しません）。スキーマフォルダ内のファイルを直せば再変換されます。スキーマフォルダの外のファイルを直した場合は再変換されないため、スキーマフォルダ内のファイルを更新（保存し直す等）するか、ページを再読み込みしてください（`build --watch` では再起動してください）。
- **`displayName` の重複**: `h1` と `h2` がどちらも `H` になるように、名前が重なるタグやノードがあります。公式と同じ挙動で、エラーにはしません。
- **未知のクエリ**: 既知の特殊なクエリ（`raw`、`url`、`inline`、`worker` など）だけを変換対象から外します。独自のクエリで元の内容を要求するプラグインがあると、そのリクエストも変換されます。
- **partial の展開量**: 1 つの partial が次の partial を複数回参照する構造を深く重ねると、Markdoc の変換で展開される量が指数的に増えます。段数の上限（32）はこの量を制限しません。
- **frontmatter のオブジェクトの埋め込み**: 本文にスカラーではなくオブジェクトの値を埋め込む（例: `{% $markdoc.frontmatter.x %}` で `x` がオブジェクト）と、描画時に React のエラー（Objects are not valid as a React child）になります。公式ローダーと同じ挙動です。
- **カスタムの `pageExtensions`**: [cloudflare/vinext#1502](https://github.com/cloudflare/vinext/issues/1502) は、一部のカスタム拡張子でビルドが失敗する Issue です。`.md` / `.mdoc` では再現しませんでした。
- **スキーマフォルダ内のリンク**: スキーマフォルダ内に置いたシンボリックリンク / ジャンクションは、ファイルの監視が再帰的にたどります（root 内のリンクと同じ扱い）。

## ファイル構成

```text
src/
  index.ts               # 公開エントリ（markdoc() と型）
  types.ts               # オプションと変換処理の型
  env.d.ts               # *.md / *.mdoc の型宣言（markdoc-vinext-plugin/env）
  transform.ts           # 変換の統括
  codegen/               # 生成コード（ページ、コンポーネント、スキーマの import、ソースマップ）
  schema/                # スキーマの解決と読み込み
  runtime/
    runtime.js           # runtime の実装（仮想モジュールとして配信）
    index.ts             # markdoc-vinext-plugin/runtime
  vite/                  # Vite のフック
  ...                    # id 判定、パス、ページ判定、オプション、partial、frontmatter、キャッシュ
examples/basic/          # サンプルのプロジェクト
  vite.config.ts         # 使用例
  next.config.js         # pageExtensions の設定例
  markdoc/               # サンプルのスキーマ
    config.ts
    tags.ts
    nodes.ts
    functions.ts
    components/Callout.tsx
    partials/footer.md
  pages/docs/getting-started.md
  app/docs/page.md
  components/note.md
test/
  unit/                  # 単体テスト
  golden/                # 生成コードのスナップショット
  integration/           # Vite を使うテスト
  helpers/               # テストの共通処理
  types/usage.ts         # 型宣言の確認（型チェックのみ）
  setup.ts               # bun test の preload
scripts/
  print-versions.ts      # 依存パッケージのバージョンの表示
biome.json
bunfig.toml
bun.lock
package.json
tsconfig.json
THIRD-PARTY-NOTICES.md   # 同梱した第三者コードのライセンス表示
```
