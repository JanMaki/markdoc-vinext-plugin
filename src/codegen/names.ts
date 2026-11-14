/** 生成モジュールのトップレベルの名前。 */

/**
 * 生成モジュールがトップレベルで宣言・export する名前と、生成コードが参照するグローバル。
 * `nextjsExports` の値と重なると、宣言名は重複宣言の構文エラー、グローバルは TDZ の ReferenceError や参照の置き換わりになる。
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
  // 生成コードが参照するグローバル (JSON: 全モード、Date: build の frontmatter、Object: runtime の getMarkdocData)。
  'JSON',
  'Date',
  'Object',
]);

/** スキーマフォルダのエントリ名。生成モジュールではこの名前で import する。 */
export const SCHEMA_ENTRIES = ['config', 'tags', 'nodes', 'functions'] as const;

export type SchemaEntry = (typeof SCHEMA_ENTRIES)[number];
/** エントリ → 解決した絶対パス。解決できなかったエントリは含まない。 */
export type SchemaFiles = Partial<Record<SchemaEntry, string>>;
