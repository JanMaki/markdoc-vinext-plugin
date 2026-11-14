import {createElement} from 'react';
import {Callout} from './components/Callout';

/**
 * カスタム Markdoc タグ。`import * as tags` で読み込み、`defaultObject` を通す (@markdoc/next.js と同じ)。
 *
 * default export があると `defaultObject` は default export を使うため、すべてのタグを default export に含める。
 * kebab-case のタグ名は default export でのみ定義できる。
 */
const tags = {
  callout: {
    render: Callout,
    attributes: {
      type: {
        type: String,
        default: 'info',
        matches: ['info', 'warn', 'warning', 'error'],
      },
    },
  },
  /** `{% tag /%}` で使う。検証用のマーカー要素 (`<span data-markdoc-tag>`) を描画する。 */
  tag: {
    render: function Tag() {
      return createElement('span', {'data-markdoc-tag': 'tag'}, 'custom-tag');
    },
  },
};

export default tags;
export const callout = tags.callout;
export const tag = tags.tag;
