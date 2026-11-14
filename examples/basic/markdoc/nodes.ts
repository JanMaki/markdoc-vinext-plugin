/**
 * カスタム Markdoc ノード (任意)。ここで上書きしないノードは Markdoc 組み込みのもの (heading、paragraph、link 等) を使う。
 *
 * 例 (リンクをカスタムコンポーネントで描画する):
 *
 *   import Link from 'next/link';
 *   export const link = { render: Link, attributes: { href: { type: String } } };
 */
const nodes = {};

export default nodes;
