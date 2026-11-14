/** スキーマモジュールの import (compile: 'build')。 */

import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {realpathOfNearestExisting} from '../fs-utils';
import {defaultObject} from '../runtime/runtime.js';
import type {MarkdocSchemaInput} from '../runtime/types';
import type {SchemaModule, TransformMarkdocContext} from '../types';
import type {SchemaFiles} from './resolve';

type LoadSchemaModulesContext = Pick<TransformMarkdocContext, 'importModule' | 'cache' | 'narrowSchemaWatch'> & {
  watch: (file: string) => void;
  schemaDir: string;
};

/** import するのは resolveSchemaEntry が受け入れたパス (schemaDir 配下) のみ。 */
async function nativeImport(file: string): Promise<SchemaModule> {
  return {module: await import(pathToFileURL(file).href), dependencies: []};
}

async function loadSchemaModule(
  file: string | undefined,
  {importModule = nativeImport, cache, watch, schemaDir, narrowSchemaWatch}: LoadSchemaModulesContext,
): Promise<Record<string, unknown>> {
  if (!file) return {};
  let entry = cache?.schemaModules.get(file);
  if (!entry) {
    const pending = importModule(file);
    entry = pending;
    cache?.schemaModules.set(file, pending);
    // 失敗した import を保持すると、原因のファイルを直しても再試行されない。
    pending.catch(() => {
      if (cache?.schemaModules.get(file) === pending) cache.schemaModules.delete(file);
    });
  }
  let loaded: SchemaModule;
  try {
    loaded = await entry;
  } catch (error) {
    // 失敗時は依存ファイルが分からない。スキーマフォルダ内の編集で再変換されるようフォルダを監視する。
    // narrowSchemaWatch ではフォルダ全体を再帰的に監視させない。
    if (!narrowSchemaWatch) watch(schemaDir);
    throw error;
  }
  const {module, dependencies} = loaded;
  // キャッシュから取得したページにも依存ファイルを登録し、変更時に再変換されるようにする。
  for (const dep of dependencies) {
    const abs = path.resolve(dep);
    cache?.deps.add(abs);
    // シンボリックリンク経由の依存ファイルの変更は実パスで通知される。
    cache?.deps.add(realpathOfNearestExisting(abs));
    watch(dep);
  }
  return module;
}

/** 解決済みのスキーマモジュールを tags / nodes / functions / config の順に import し、スキーマにまとめる。 */
export async function loadSchemaModules(
  files: SchemaFiles,
  ctx: LoadSchemaModulesContext,
): Promise<MarkdocSchemaInput> {
  return {
    tags: defaultObject(await loadSchemaModule(files.tags, ctx)),
    nodes: defaultObject(await loadSchemaModule(files.nodes, ctx)),
    functions: defaultObject(await loadSchemaModule(files.functions, ctx)),
    ...defaultObject(await loadSchemaModule(files.config, ctx)),
  } as MarkdocSchemaInput;
}
