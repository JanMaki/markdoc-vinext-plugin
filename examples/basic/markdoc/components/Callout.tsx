import type {ReactNode} from 'react';

export type CalloutProps = {
  type?: 'info' | 'warn' | 'warning' | 'error';
  children?: ReactNode;
};

/**
 * カスタム Markdoc タグの描画コンポーネント (サンプル)。
 * Pages Router の SSR と App Router の Server Components の両方で描画できるよう、hooks と "use client" を使わない。
 */
export function Callout({type = 'info', children}: CalloutProps) {
  const kind = type === 'warning' ? 'warn' : type;
  return (
    // 本文中の補足のため、補完的なランドマークになる <aside> ではなく role="note" を使う。
    <div role="note" className={`callout callout-${kind}`} data-callout={kind}>
      {children}
    </div>
  );
}

export default Callout;
