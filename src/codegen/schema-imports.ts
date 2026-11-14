/**
 * スキーマモジュールの import と `schema` の宣言の生成。
 * @markdoc/next.js の src/loader.js を元にしている (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
 */

import {getRelativeImportPath} from '../paths';
import {SCHEMA_ENTRIES, type SchemaFiles} from './names';

/**
 * `schema` を宣言するコード。解決できなかったエントリは空のオブジェクトにする。
 * @param importer import 指定子の基準にする変換対象のファイル
 */
export function emitSchemaCode(spec: {exists: boolean; files: SchemaFiles; importer: string}): string {
  if (!spec.exists) return 'const schema = {};';
  const imports = SCHEMA_ENTRIES.map((variable) => {
    const file = spec.files[variable];
    if (!file) return `const ${variable} = {};`;
    return `import * as ${variable} from ${JSON.stringify(getRelativeImportPath(spec.importer, file))};`;
  });
  return [
    ...imports,
    'const schema = {',
    'tags: defaultObject(tags),',
    'nodes: defaultObject(nodes),',
    'functions: defaultObject(functions),',
    '...defaultObject(config),',
    '};',
  ].join('\n');
}
