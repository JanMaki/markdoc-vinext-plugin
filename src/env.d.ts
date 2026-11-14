/**
 * markdoc-vinext-plugin が変換する Markdoc ファイルの ambient モジュール宣言。
 * アプリ側の `*.d.ts` で次のように参照する:
 *
 *   /// <reference types="markdoc-vinext-plugin/env" />
 */

declare module '*.md' {
  import type {RenderableTreeNode} from '@markdoc/markdoc';
  import type {ComponentType} from 'react';

  export type MarkdocPageProps = {
    markdoc?: {
      content: RenderableTreeNode | null;
      frontmatter: Record<string, unknown>;
      file: {path: string | undefined};
    };
    // biome-ignore lint/suspicious/noExplicitAny: props の型が異なる任意のコンポーネントを受け取る。
    components?: Record<string, ComponentType<any>>;
  };

  export const markdoc: {frontmatter: Record<string, unknown>};
  // 以下はファイルの場所で存在が決まるため、すべて宣言する。App Router のページは metadata / revalidate、
  // Pages Router のページは getStaticProps / getServerSideProps を export する。nextjsExports で追加した名前は宣言しない。
  export const metadata: unknown;
  export const revalidate: number | false | undefined;
  export function getStaticProps(context?: unknown): Promise<{props: {markdoc: MarkdocPageProps['markdoc']}}>;
  export function getServerSideProps(context?: unknown): Promise<{props: {markdoc: MarkdocPageProps['markdoc']}}>;

  const MarkdocComponent: ComponentType<MarkdocPageProps>;
  export default MarkdocComponent;
}

// `*.md` と同じ宣言。
declare module '*.mdoc' {
  export * from '*.md';
  export {default} from '*.md';
}
