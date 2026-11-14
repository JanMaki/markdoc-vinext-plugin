/** compile: 'build' の変換時の transform。 */

import type {Node, Tokenizer} from '@markdoc/markdoc';
import {type DatePath, serializeFrontmatter} from './codegen/build-module';
import type {MarkdocModule} from './markdoc-deps';
import {getSchema} from './runtime/runtime.js';
import type {MarkdocSchemaInput} from './runtime/types';

export type PrerenderInput = {
  Markdoc: MarkdocModule;
  tokenizer: Tokenizer;
  parseOptions: {slots: boolean};
  ast: Node;
  source: string;
  filepath: string | undefined;
  frontmatter: Record<string, unknown>;
  /** partial のファイル名 → 内容。 */
  partials: Record<string, string>;
  schema: MarkdocSchemaInput;
};

/** Markdoc.transform を実行し、埋め込む JSON を返す。 */
export async function prerenderMarkdoc(
  input: PrerenderInput,
): Promise<{data: string; frontmatter: {json: string; datePaths: DatePath[]}}> {
  const {Markdoc, tokenizer, parseOptions, frontmatter} = input;
  const {components: _components, ...rest} = getSchema(input.schema);
  const partials = Object.fromEntries(
    Object.entries(input.partials).map(([key, value]) => [key, Markdoc.parse(tokenizer.tokenize(value), parseOptions)]),
  );
  const cfg = {
    ...rest,
    variables: {...rest.variables, markdoc: {frontmatter}},
    partials,
    source: input.source,
  };
  const content = await Markdoc.transform(input.ast, cfg as Parameters<typeof Markdoc.transform>[1]);
  return {
    data: JSON.stringify({content, frontmatter, file: {path: input.filepath}}),
    frontmatter: serializeFrontmatter(frontmatter),
  };
}
