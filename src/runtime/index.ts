/**
 * `markdoc-vinext-plugin/runtime`。@markdoc/next.js の runtime 相当のヘルパー。
 * `renderReact` は `virtual:markdoc-vinext/runtime` 専用のため含めない。
 */
export {defaultObject, displayName, getSchema, sanitizeFrontmatter} from './runtime.js';
export type {MarkdocRuntimeSchema, MarkdocSchemaInput, Registration} from './types';
