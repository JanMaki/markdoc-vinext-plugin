// @ts-check
// runtime の唯一の実装。`virtual:markdoc-vinext/runtime` としてブラウザに配信されるため、
// Vite の既定の client target を超える API (Object.hasOwn 等) は使わない。

/** @typedef {import('./types').Registration} Registration */
/** @typedef {import('./types').MarkdocSchemaInput} MarkdocSchemaInput */
/** @typedef {import('./types').MarkdocRuntimeSchema} MarkdocRuntimeSchema */

// displayName / getSchema / defaultObject は @markdoc/next.js の src/runtime.js を元にしている
// (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。

/**
 * 英字以外を区切りに PascalCase へ変換する (`my-tag` → `MyTag`)。英字がなければそのまま返す。
 * @param {string} name
 * @returns {string}
 */
export function displayName(name) {
  const words = name.match(/[a-z]+/gi);
  if (!words) return name;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
}

/**
 * tag / node の定義の `render` を PascalCase の名前に置き換え、コンポーネントを別に集める。
 * @param {Record<string, Registration> | undefined} config
 * @returns {{output: Record<string, any>, components: Record<string, unknown>}}
 */
function transformRecord(config) {
  /** @type {Record<string, any>} */
  const output = {};
  /** @type {Record<string, unknown>} */
  const components = {};
  if (config) {
    for (const [name, registration] of Object.entries(config)) {
      const componentName = registration.render ? displayName(name) : undefined;
      output[name] = {...registration, render: componentName};
      if (componentName) {
        components[componentName] = registration.render;
      }
    }
  }
  return {output, components};
}

/**
 * tag / node の `render` 関数を PascalCase のコンポーネント名に置き換え、renderable tree を
 * JSON シリアライズできるようにする。コンポーネントは `components` として返し、Markdoc.renderers.react に渡す。
 * @param {MarkdocSchemaInput} schema
 * @returns {MarkdocRuntimeSchema}
 */
export function getSchema(schema) {
  const {output: tags, components: tagComponents} = transformRecord(schema.tags);
  const {output: nodes, components: nodeComponents} = transformRecord(schema.nodes);
  return {
    ...schema,
    tags,
    nodes,
    components: {...tagComponents, ...nodeComponents},
  };
}

/** frontmatter の値の数の上限。YAML のエイリアスは参照を共有するため、展開後の数で数える。 */
const FRONTMATTER_NODE_LIMIT = 100000;

/**
 * frontmatter から `$$mdtype` キーを取り除いた複製を返す。
 * `$$mdtype: Tag` を持つオブジェクトはレンダラーが Tag として描画するため、本文の作成者が任意の要素や
 * `dangerouslySetInnerHTML` を出力できる。Markdoc のタグ構文も変数のオブジェクトから同じキーを取り除く。
 * 型付き配列は数値の配列にする。プレーンなオブジェクトと配列は複製し、それ以外 (Date 等) はそのまま返す。循環参照は例外にする。
 * @param {unknown} value
 * @param {{remaining: number}} [budget]
 * @param {Set<unknown>} [ancestors]
 * @returns {unknown}
 */
export function sanitizeFrontmatter(value, budget = {remaining: FRONTMATTER_NODE_LIMIT}, ancestors = new Set()) {
  const view =
    ArrayBuffer.isView(value) && !(value instanceof DataView)
      ? /** @type {ArrayLike<number>} */ (/** @type {unknown} */ (value))
      : undefined;
  budget.remaining -= 1 + (view ? view.length : 0);
  if (budget.remaining < 0) {
    throw new Error(
      `[markdoc-vinext] Frontmatter has more than ${FRONTMATTER_NODE_LIMIT} values (including YAML alias expansion).`,
    );
  }
  // `!!binary` の Uint8Array は JSON で `{"0": …}` になる。JSON で埋め込む compile: 'build' と値を揃えるため数値の配列にする。
  if (view) return Array.from(view);
  const isArray = Array.isArray(value);
  if (!isArray && !(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)) {
    return value;
  }
  // YAML のアンカーは自身を参照できる (`a: &x [*x]`)。
  if (ancestors.has(value)) throw new Error('[markdoc-vinext] Frontmatter contains a circular reference.');
  ancestors.add(value);
  /** @type {unknown} */
  let output;
  if (Array.isArray(value)) {
    output = value.map((item) => sanitizeFrontmatter(item, budget, ancestors));
  } else {
    /** @type {Record<string, unknown>} */
    const record = {};
    for (const [key, item] of Object.entries(/** @type {object} */ (value))) {
      if (key === '$$mdtype') continue;
      // `__proto__` キーも自身のプロパティとして残す。
      Object.defineProperty(record, key, {
        value: sanitizeFrontmatter(item, budget, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    output = record;
  }
  ancestors.delete(value);
  return output;
}

/**
 * `o.default` (ESM の default export) があればそれを、なければ `o` を返す。null / undefined の場合は `{}`。
 * @template T
 * @param {T | {default: T} | null | undefined} o
 * @returns {T | Record<string, never>}
 */
export function defaultObject(o) {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn はブラウザの client target 外
  if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, 'default')) {
    return /** @type {{default: T}} */ (o).default;
  }
  return /** @type {T} */ (o) || {};
}

// compile: 'build' の client モジュール用の Markdoc.renderers.react のコピー
// (@markdoc/markdoc 0.5.x src/renderers/react/react.ts, MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
/**
 * @param {unknown} name
 * @param {any} components
 * @returns {any}
 */
function tagName(name, components) {
  return typeof name !== 'string'
    ? name
    : name[0] !== name[0].toUpperCase()
      ? name
      : components instanceof Function
        ? components(name)
        : components[name];
}

/**
 * @param {any} node
 * @param {any} React
 * @param {{components?: any, resolveTagName?: (name: unknown, components: any) => any}} [options]
 * @returns {any}
 */
export function renderReact(node, React, {components = {}, resolveTagName = tagName} = {}) {
  /**
   * @param {any} value
   * @returns {any}
   */
  function deepRender(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => deepRender(item));
    if (value.$$mdtype === 'Tag') return render(value);
    /** @type {Record<string, any>} */
    const output = {};
    for (const [k, v] of Object.entries(value)) output[k] = deepRender(v);
    return output;
  }
  /**
   * @param {any} node
   * @returns {any}
   */
  function render(node) {
    if (Array.isArray(node)) return React.createElement(React.Fragment, null, ...node.map(render));
    if (node === null || typeof node !== 'object' || node.$$mdtype !== 'Tag') return node;
    const {name, attributes: {class: className, ...attrs} = {}, children = []} = node;
    if (className) attrs.className = className;
    return React.createElement(
      resolveTagName(name, components),
      Object.keys(attrs).length === 0 ? null : deepRender(attrs),
      ...children.map(render),
    );
  }
  return render(node);
}
