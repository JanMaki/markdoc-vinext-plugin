import {createElement, type ReactElement} from 'react';
import {renderToString} from 'react-dom/server';

/** 生成モジュールの props。 */
export type MarkdocDataProps = {
  markdoc?: {content?: unknown; frontmatter?: Record<string, unknown>; file?: {path?: string}};
};

/** 生成モジュール (ページ、コンポーネント、ビルド結果) の export。 */
export type PageModule = {
  default: (props: object) => ReactElement | Promise<ReactElement>;
  getStaticProps?: (ctx: unknown) => Promise<{props: MarkdocDataProps}>;
  getServerSideProps?: (ctx: unknown) => Promise<{props: MarkdocDataProps}>;
  markdoc: {frontmatter: Record<string, unknown>};
  metadata?: unknown;
  revalidate?: unknown;
};

/** 生成モジュールの default export を HTML 文字列にする。 */
export async function renderModule(mod: PageModule, props: object = {}): Promise<string> {
  return renderToString((await mod.default(props)) ?? createElement('div'));
}

/** renderReact と Markdoc.renderers.react の比較に使うコンポーネント。 */
export const PARITY_COMPONENTS = {
  Callout: (p: {children?: unknown}) => createElement('aside', {className: 'c'}, p.children as never),
  Tag: () => createElement('b', null, 'T'),
};
