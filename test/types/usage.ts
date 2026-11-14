/**
 * `bun run typecheck` でのみ検査し、実行しない。
 * Markdoc ファイルの import が src/env.d.ts で型解決されることと、公開型の形を確認する。
 */
import {createElement} from 'react';
import Note, {markdoc as noteMarkdoc} from '../../examples/basic/components/note.md';
import type {MarkdocPageProps} from '../../examples/basic/pages/docs/getting-started.md';
import type {
  MarkdocNextJsPageProps,
  MarkdocRouter,
  MarkdocTokenizerOptions,
  MarkdocVitePluginOptions,
} from '../../src/index';
// `*.mdoc` は `*.md` の宣言を再 export する。
import MdocPage, {getStaticProps, type MarkdocPageProps as MdocPageProps} from './example.mdoc';

const props: MarkdocPageProps = {components: {}};
const pluginProps: MarkdocNextJsPageProps = props;
export const element = createElement(Note, pluginProps);
export const title: unknown = noteMarkdoc.frontmatter.title;

const mdocProps: MdocPageProps = props;
export const mdocElement = createElement(MdocPage, mdocProps);
export const mdocData = getStaticProps();

const tokenizer: MarkdocTokenizerOptions = {allowComments: true, slots: true};
const router: MarkdocRouter = 'auto';

/** すべてのオプションを指定できる。 */
export const fullOptions: MarkdocVitePluginOptions = {
  schemaPath: './markdoc',
  mode: 'server',
  extensions: ['.md', '.mdoc'],
  extension: /\.mdoc?$/,
  partialExtensions: ['.md'],
  options: tokenizer,
  tokenizerOptions: tokenizer,
  nextjsExports: ['metadata'],
  router,
  dir: '.',
  appDir: 'app',
  pagesDir: 'pages',
  compile: 'build',
  fastRefresh: true,
};

// @ts-expect-error 未知のオプション
export const unknownKey: MarkdocVitePluginOptions = {unknownOption: true};
// @ts-expect-error compile は 'runtime' | 'build' のみ
export const invalidCompile: MarkdocVitePluginOptions = {compile: 'invalid'};
// @ts-expect-error router は 'pages' | 'app' | 'auto' のみ
export const invalidRouter: MarkdocRouter = 'invalid';
