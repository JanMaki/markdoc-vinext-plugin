/** 生成モジュールのトップレベルの名前。 */

/**
 * 生成モジュールがトップレベルで宣言・export する名前。
 * `nextjsExports` の値と重なると重複宣言の構文エラーになる。
 */
export const GENERATED_MODULE_NAMES = new Set([
  'React',
  'yamlLoad',
  'Markdoc',
  'getSchema',
  'defaultObject',
  'sanitizeFrontmatter',
  'schema',
  'config',
  'tags',
  'nodes',
  'functions',
  'tokenizer',
  'source',
  'filepath',
  'tokens',
  'parseOptions',
  'ast',
  'frontmatter',
  'components',
  'rest',
  'getMarkdocData',
  'MarkdocComponent',
  'markdocData',
  '__markdocInternal',
  'renderReact',
  'markdoc',
  'default',
  'getStaticProps',
  'getServerSideProps',
]);

/** スキーマフォルダのエントリ名。生成モジュールではこの名前で import する。 */
export const SCHEMA_ENTRIES = ['config', 'tags', 'nodes', 'functions'] as const;

export type SchemaEntry = (typeof SCHEMA_ENTRIES)[number];
/** エントリ → 解決した絶対パス。解決できなかったエントリは含まない。 */
export type SchemaFiles = Partial<Record<SchemaEntry, string>>;
