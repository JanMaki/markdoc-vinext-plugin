/** transform フック。Markdoc ファイルを変換し、スキーマの読み込みと解決を Vite に委ねる。 */

import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as vite from 'vite';
import {normalizePath, type Plugin, type Rollup} from 'vite';
import {isFile} from '../fs-utils';
import {shouldTransformId, splitQuery, stripQueryAndHash, transformIdFilter} from '../id';
import {COMPONENT_QUERY} from '../module-ids';
import {fastRefreshComponentModule} from '../page-detection';
import {transformMarkdoc} from '../transform';
import type {TransformMarkdocContext} from '../types';
import type {PluginState} from './state';

/** スキーマファイルを読み込む。 */
function createImportModule(state: PluginState): NonNullable<TransformMarkdocContext['importModule']> {
  return async (schemaFile) => {
    // runnerImport (Vite ≥ 6.1、実験的機能) で TS / TSX のスキーマファイルを Vite で処理する。
    // Vite 6.0 ではネイティブの import() を使う。TSX は扱えず、Node の ESM キャッシュにより
    // 再起動までスキーマファイルの初回の内容が使われる。
    if (typeof vite.runnerImport !== 'function') {
      return {module: await import(pathToFileURL(schemaFile).href), dependencies: []};
    }
    const {module, dependencies} = await vite.runnerImport<Record<string, unknown>>(schemaFile, {
      root: state.root,
      logLevel: 'error',
      resolve: {alias: state.alias},
    });
    return {module, dependencies: dependencies.filter((dep): dep is string => typeof dep === 'string')};
  };
}

/** 相対リクエストを Vite のリゾルバ (拡張子、index ファイル) で解決する。 */
function createResolve(ctx: Pick<Rollup.PluginContext, 'resolve'>): NonNullable<TransformMarkdocContext['resolve']> {
  return async (contextDir, request) => {
    const importer = path.join(contextDir, '__markdoc_schema_importer.js');
    const resolved = await ctx.resolve(request, importer, {skipSelf: true});
    if (resolved && !resolved.external && !resolved.id.startsWith('\0')) {
      const clean = stripQueryAndHash(resolved.id);
      if (await isFile(clean)) return clean;
    }
    return null;
  };
}

export function createTransformHook(state: PluginState): NonNullable<Plugin['transform']> {
  const {options: pluginOptions} = state;
  return {
    filter: {id: {include: transformIdFilter(pluginOptions)}},
    async handler(code, id, options) {
      // Vite < 6.3 (フックフィルタなし) とクエリの特殊ケース用。
      if (!shouldTransformId(id, pluginOptions)) return null;

      const {file, query} = splitQuery(id);
      const resourcePath = path.resolve(file);
      if (pluginOptions.fastRefresh && new URLSearchParams(query).has(COMPONENT_QUERY)) {
        return fastRefreshComponentModule(resourcePath, state.root, pluginOptions);
      }
      state.markdocFiles.add(normalizePath(resourcePath));

      const result = await transformMarkdoc(code, {
        resourcePath,
        root: state.root,
        options: pluginOptions,
        consumer: this.environment?.config.consumer ?? (options?.ssr ? 'server' : 'client'),
        cache: state.cache,
        watchMissingSchemaEntries: state.isBuild && this.meta.watchMode,
        narrowSchemaWatch: state.narrowSchemaWatch,
        importModule: createImportModule(state),
        resolve: createResolve(this),
        addWatchFile: (file) => {
          this.addWatchFile(file);
        },
      });

      return {code: result.code, map: result.map};
    },
  };
}
