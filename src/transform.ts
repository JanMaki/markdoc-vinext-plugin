/** Markdoc ソースからページ / コンポーネントモジュールへの変換。 */

import path from 'node:path';
import {emitBuildHead} from './codegen/build-module';
import {emitPageModule} from './codegen/page-module';
import {emitRuntimeHead} from './codegen/runtime-module';
import {emitSchemaCode} from './codegen/schema-imports';
import type {ModuleKind} from './codegen/shared';
import {markdownSourceMap} from './codegen/source-map';
import {loadFrontmatter} from './frontmatter';
import {realpathOfNearestExisting} from './fs-utils';
import {loadMarkdocDeps} from './markdoc-deps';
import {
  DEFAULT_NEXTJS_EXPORTS,
  DEFAULT_PARTIAL_EXTENSIONS,
  getSchemaDir,
  resolveProjectRoot,
  resolveSchemaPath,
  tokenizerAndParseOptions,
  validateNextjsExports,
} from './options';
import {resolvePageContext} from './page-detection';
import {gatherPartials, type PartialState, type WatchFn} from './partials';
import {type PrerenderInput, prerenderMarkdoc} from './prebuild';
import {loadSchemaModules} from './schema/load';
import {resolveSchemaFiles, type SchemaFiles} from './schema/resolve';
import type {MarkdocVitePluginOptions, TransformMarkdocContext, TransformMarkdocResult} from './types';

/**
 * 監視するファイルを重複なく集め、見つけた順に `addWatchFile` に渡す。
 * シンボリックリンク経由のスキーマフォルダでは、ファイルの変更は実パスで通知されるため実パスも登録する。
 * `real: false` では実パスを登録しない。
 */
function createWatchCollector(addWatchFile?: (file: string) => void) {
  const files = new Set<string>();
  const add = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    addWatchFile?.(file);
  };
  const watch: WatchFn = (file, options) => {
    const abs = path.resolve(file);
    add(abs);
    if (options?.real === false) return;
    const real = realpathOfNearestExisting(abs);
    if (real !== abs) add(real);
  };
  return {watch, files};
}

/**
 * 実行時に transform する ('runtime') か、変換時に transform 済みの tree を埋め込む ('prebuilt') か。
 * リクエスト時の context.variables を参照するのは server の Pages getServerSideProps のみのため、
 * compile: 'build' でもそれは実行時に transform する。
 */
function selectVariant(
  options: MarkdocVitePluginOptions,
  consumer: 'client' | 'server',
  kind: ModuleKind,
): 'runtime' | 'prebuilt' {
  if (options.compile !== 'build') return 'runtime';
  return consumer === 'server' && kind === 'pages-page' && options.mode === 'server' ? 'runtime' : 'prebuilt';
}

type Parsed = Pick<PrerenderInput, 'Markdoc' | 'tokenizer' | 'parseOptions' | 'ast'> & {
  tokenizerOptions: Record<string, unknown>;
};

type PartialsInput = Pick<PartialState, 'allowedExtensions' | 'cache' | 'watch'> & {
  resourcePath: string;
  schemaDir: string;
};

/** partial を集める。`{% partial %}` の file 属性 → 内容。 */
async function collectPartials(parsed: Parsed, input: PartialsInput): Promise<Record<string, string>> {
  const {resourcePath, allowedExtensions, cache, watch} = input;
  const {Markdoc, tokenizer, parseOptions} = parsed;
  const state: PartialState = {
    partials: new Map(),
    stack: [path.resolve(resourcePath)],
    partialsDir: path.resolve(input.schemaDir, 'partials'),
    realPartialsDir: null,
    allowedExtensions,
    Markdoc,
    cache,
    tokenizer,
    parseOptions,
    importer: resourcePath,
    watch,
  };
  await gatherPartials(parsed.ast, state);
  return Object.fromEntries(state.partials);
}

type HeadInput = {
  parsed: Parsed;
  context: TransformMarkdocContext;
  variant: 'runtime' | 'prebuilt';
  page: Pick<PrerenderInput, 'source' | 'filepath' | 'frontmatter' | 'partials'> & {
    kind: ModuleKind;
    consumer: 'client' | 'server';
  };
  schemaFiles: {exists: boolean; files: SchemaFiles};
  schemaDir: string;
  watch: (file: string) => void;
};

/** モジュールの先頭部分。'prebuilt' ではスキーマモジュールを import して transform する。 */
async function createModuleHead(input: HeadInput): Promise<string> {
  const {parsed, context, schemaFiles} = input;
  const {kind, source, filepath, partials} = input.page;
  const schemaCode = emitSchemaCode({...schemaFiles, importer: context.resourcePath});
  if (input.variant === 'runtime') {
    const {tokenizerOptions, parseOptions} = parsed;
    return emitRuntimeHead({kind, schemaCode, tokenizerOptions, parseOptions, source, filepath, partials});
  }
  const loadContext = {...context, watch: input.watch, schemaDir: input.schemaDir};
  const schema = schemaFiles.exists ? await loadSchemaModules(schemaFiles.files, loadContext) : {};
  const prerendered = await prerenderMarkdoc({...parsed, ...input.page, schema});
  return emitBuildHead({kind, consumer: input.page.consumer, schemaCode, ...prerendered});
}

/** Markdoc ソースを React コンポーネントモジュールに変換する。生成形式は公式ローダーに合わせる。 */
export async function transformMarkdoc(
  source: string,
  context: TransformMarkdocContext,
): Promise<TransformMarkdocResult> {
  const {resourcePath, options, cache} = context;
  const root = resolveProjectRoot(options, context.root);
  const {watch, files: watchFiles} = createWatchCollector(context.addWatchFile);
  const {tokenizerOptions, parseOptions} = tokenizerAndParseOptions(options);
  const nextjsExports = validateNextjsExports(options.nextjsExports ?? DEFAULT_NEXTJS_EXPORTS);
  const schemaDir = getSchemaDir(root, options);

  const {Markdoc, yamlLoad} = await loadMarkdocDeps();
  const tokenizer = new Markdoc.Tokenizer(tokenizerOptions);
  const ast = Markdoc.parse(tokenizer.tokenize(source), parseOptions);
  const parsed: Parsed = {Markdoc, tokenizer, tokenizerOptions, parseOptions, ast};
  const frontmatter = loadFrontmatter(ast.attributes.frontmatter, yamlLoad, resourcePath);

  const {isPage, appMode, filepath, kind} = resolvePageContext(resourcePath, root, options);
  const allowedExtensions = options.partialExtensions ?? DEFAULT_PARTIAL_EXTENSIONS;
  const partials = await collectPartials(parsed, {resourcePath, schemaDir, allowedExtensions, cache, watch});
  const schemaPath = resolveSchemaPath(options);
  const schemaFiles = await resolveSchemaFiles(schemaDir, {...context, schemaPath, watch});

  const consumer = context.consumer ?? 'client';
  const variant = selectVariant(options, consumer, kind);
  const page = {kind, consumer, source, filepath, frontmatter, partials};
  const head = await createModuleHead({parsed, context, variant, page, schemaFiles, schemaDir, watch});
  const code = emitPageModule({kind, head, options, nextjsExports, resourcePath});

  return {
    code,
    // client の軽量モジュールは Rollup の「マップなし」形式にする。.md をソースとするマップがあると、
    // Rollup は build.sourcemap の出力の sourcesContent に Markdown をそのまま入れる。
    map:
      variant === 'prebuilt' && consumer === 'client' ? {mappings: ''} : markdownSourceMap(code, resourcePath, source),
    watchFiles: [...watchFiles],
    meta: {isPage, appMode, filepath, schemaDir},
  };
}
