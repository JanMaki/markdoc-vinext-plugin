/** runtime.js のスキーマの型。 */

import type {Config, Schema} from '@markdoc/markdoc';

/** `render` がコンポーネント (関数) または名前の tag / node 定義。 */
export type Registration = Omit<Schema, 'render'> & {render?: unknown};

export type MarkdocSchemaInput = Omit<Config, 'tags' | 'nodes'> & {
  tags?: Record<string, Registration>;
  nodes?: Record<string, Registration>;
};

export type MarkdocRuntimeSchema = Omit<Config, 'tags' | 'nodes'> & {
  tags: Record<string, Schema>;
  nodes: Record<string, Schema>;
  components: Record<string, unknown>;
};
