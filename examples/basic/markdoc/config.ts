/**
 * Markdoc の設定 (任意)。プラグインが最後に展開するため、tags / nodes / functions の上書きや
 * variables の追加ができる。partials と source はプラグインが設定する。
 *
 * 公式の /markdoc/config.js に相当 (markdoc.dev/docs/nextjs 参照)。
 */
const config = {
  variables: {
    product: 'Vinext',
  },
};

export default config;
