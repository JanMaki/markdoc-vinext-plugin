/** config / configResolved フックと、その純粋な計算部分。 */

import os from 'node:os';
import path from 'node:path';
import {type Plugin, searchForWorkspaceRoot, type UserConfig} from 'vite';
import {clearMarkdocCache} from '../cache';
import {realpathOrSelf} from '../fs-utils';
import {getSchemaDir, resolveProjectRoot} from '../options';
import {isInside, isTooBroadToAllow} from '../paths';
import type {MarkdocVitePluginOptions} from '../types';
import type {PluginState} from './state';

type ConfigExtrasEnv = {
  cwd: string;
  home: string;
  /** Vite の既定の `server.fs.allow` (ワークスペースルート)。 */
  workspaceRoot: (root: string) => string;
  /** 実パス。解決できなければ引数をそのまま返す。 */
  realpath: (p: string) => string;
};

/** スキーマフォルダとプロジェクトルートの、指定どおりのパスと実パス。 */
export type SchemaDirPlacement = {schemaDir: string; realSchemaDir: string; root: string; realRoot: string};

/** `root` は Vite の `config.root`。スキーマフォルダは `dir` オプションを基準にする。 */
export function schemaDirPlacement(
  root: string,
  options: MarkdocVitePluginOptions,
  realpath: (p: string) => string,
): SchemaDirPlacement {
  const schemaDir = getSchemaDir(resolveProjectRoot(options, root), options);
  return {schemaDir, realSchemaDir: realpath(schemaDir), root, realRoot: realpath(root)};
}

/** 指定どおりのパスと実パスのどちらかがルートを含む。 */
function containsRoot({schemaDir, realSchemaDir, root, realRoot}: SchemaDirPlacement): boolean {
  return isInside(schemaDir, root) || isInside(realSchemaDir, realRoot);
}

/** 指定どおりのパスと実パスのどちらかがファイルシステムのルートかホームディレクトリを含む。 */
function tooBroad({schemaDir, realSchemaDir}: SchemaDirPlacement, home: string): boolean {
  return isTooBroadToAllow(schemaDir, home) || isTooBroadToAllow(realSchemaDir, home);
}

/** ルートやホームディレクトリを含むスキーマフォルダ。フォルダ全体を監視せず、partials と各エントリの候補パスのみスキーマのファイルとして扱う。 */
export function shouldNarrowSchemaWatch(placement: SchemaDirPlacement, home: string): boolean {
  return containsRoot(placement) || tooBroad(placement, home);
}

/**
 * `server.fs.allow` に加えるスキーマフォルダのパス。実パスと、ルートの外にあれば指定どおりのパス。
 * ルートを含む、またはファイルシステムのルートやホームディレクトリを含むディレクトリは、無関係なファイルまで
 * /@fs/ で公開するため、どちらかのパスが該当すれば加えない。この場合は configResolved で警告する。
 */
export function schemaDirsToAllow(placement: SchemaDirPlacement, home: string): string[] {
  if (shouldNarrowSchemaWatch(placement, home)) return [];
  const {schemaDir, realSchemaDir, root, realRoot} = placement;
  // 実体がルート内なら Vite の既定の許可範囲に含まれる。
  if (isInside(realRoot, realSchemaDir)) return [];
  return isInside(root, schemaDir) || schemaDir === realSchemaDir ? [realSchemaDir] : [schemaDir, realSchemaDir];
}

/** config フックで返す設定。 */
export function computeConfigExtras(
  userConfig: UserConfig,
  options: MarkdocVitePluginOptions,
  env: ConfigExtrasEnv,
): UserConfig {
  const viteRoot = path.resolve(userConfig.root ?? env.cwd);
  const allow = schemaDirsToAllow(schemaDirPlacement(viteRoot, options, env.realpath), env.home);
  const userInclude = userConfig.optimizeDeps?.include ?? [];
  // Vite は返した設定をディープマージする (配列は連結) ため、ユーザーの値は残る。
  const extra: UserConfig = {
    optimizeDeps: {include: ['@markdoc/markdoc', 'js-yaml'].filter((dep) => !userInclude.includes(dep))},
  };
  if (allow.length) {
    // fs.allow を指定すると Vite の既定値 (ワークスペースルート) が置き換わるため、ユーザー未指定時は既定値も加える。
    extra.server = {fs: {allow: userConfig.server?.fs?.allow ? allow : [env.workspaceRoot(viteRoot), ...allow]}};
  }
  return extra;
}

type SchemaPathDiagnostic = {level: 'warn' | 'info'; message: string};

const NARROWED_WATCH =
  'Only its existing partials folder is watched; restart the dev server (or build --watch) after adding ' +
  'config/tags/nodes/functions files or a new partials folder.';

/** schemaPath の配置に対する警告 / 情報。`server.fs.allow` については schemaDirsToAllow と同じ判定を使う。 */
export function diagnoseSchemaPath(placement: SchemaDirPlacement, home: string): SchemaPathDiagnostic | undefined {
  const {schemaDir} = placement;
  // シンボリックリンク経由のルートでも判定できるよう実パスで比較する。
  if (placement.realSchemaDir === placement.realRoot) {
    return {
      level: 'warn',
      message:
        `[markdoc-vinext] schemaPath (${schemaDir}) is the project root. Only files in its partials folder and ` +
        'its config/tags/nodes/functions entries are treated as schema files. Point schemaPath at a dedicated folder.',
    };
  }
  if (containsRoot(placement)) {
    return {
      level: 'warn',
      message:
        `[markdoc-vinext] schemaPath (${schemaDir}) contains the project root, so it was not added to ` +
        `\`server.fs.allow\`. ${NARROWED_WATCH} Point schemaPath at a dedicated folder, or add it to \`server.fs.allow\` manually.`,
    };
  }
  if (tooBroad(placement, home)) {
    return {
      level: 'warn',
      message:
        `[markdoc-vinext] schemaPath (${schemaDir}) is a filesystem root or contains the home directory, so it was not ` +
        `added to \`server.fs.allow\`. ${NARROWED_WATCH} Point schemaPath at a dedicated folder.`,
    };
  }
  if (schemaDirsToAllow(placement, home).length === 0) return undefined;
  return {
    level: 'info',
    message: `[markdoc-vinext] schemaPath points outside the project root (${schemaDir}); it was added to \`server.fs.allow\`.`,
  };
}

export function createConfigHook(state: PluginState): NonNullable<Plugin['config']> {
  return (userConfig) =>
    computeConfigExtras(userConfig, state.options, {
      cwd: process.cwd(),
      home: os.homedir(),
      workspaceRoot: (root) => searchForWorkspaceRoot(root),
      realpath: realpathOrSelf,
    });
}

export function createConfigResolvedHook(state: PluginState): NonNullable<Plugin['configResolved']> {
  const {options} = state;
  return (config) => {
    // config() で `server.fs.allow` に加えたパスと一致させるため、ルートは実パスにしない。
    state.root = resolveProjectRoot(options, config.root);
    // インライン設定の変更による再起動ではプラグインのインスタンスが再利用される。
    clearMarkdocCache(state.cache);
    state.alias = config.resolve.alias;
    state.isBuild = config.command === 'build';
    if (options.extension && options.extensions) {
      config.logger.warn(
        '[markdoc-vinext] Both `extension` and `extensions` are set; `extension` (RegExp) takes precedence.',
      );
    }
    state.realSchemaDirs.clear();
    const placement = schemaDirPlacement(config.root, options, realpathOrSelf);
    state.narrowSchemaWatch = shouldNarrowSchemaWatch(placement, os.homedir());
    const diagnostic = diagnoseSchemaPath(placement, os.homedir());
    if (diagnostic) config.logger[diagnostic.level](diagnostic.message);
  };
}
