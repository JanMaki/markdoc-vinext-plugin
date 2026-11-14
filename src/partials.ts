/** `{% partial %}` の読み込みと展開。 */

import fs from 'node:fs';
import path from 'node:path';
import type Markdoc from '@markdoc/markdoc';
import {isDirectory, realpathOfNearestExisting} from './fs-utils';
import {hasExtension} from './id';
import type {MarkdocModule} from './markdoc-deps';
import {isInside} from './paths';
import type {MarkdocCache} from './types';

/** `{% partial %}` のネスト上限。 */
export const MAX_PARTIAL_DEPTH = 32;

/** ファイルを監視対象に加える。`real: false` では実パスを加えない。 */
export type WatchFn = (file: string, options?: {real?: boolean}) => void;

export type PartialState = {
  partials: Map<string, string>;
  /** 展開中の partial の絶対パス (循環検出用)。 */
  stack: string[];
  partialsDir: string;
  realPartialsDir: string | null;
  allowedExtensions: string[];
  Markdoc: MarkdocModule;
  cache: MarkdocCache | undefined;
  tokenizer: InstanceType<typeof Markdoc.Tokenizer>;
  parseOptions: {slots: boolean};
  importer: string;
  watch: WatchFn;
};

function partialChain(state: PartialState, next: string): string {
  return [...state.stack, next].map((f) => path.relative(state.partialsDir, f) || f).join(' -> ');
}

/** partialsDir 配下か、許可された拡張子か、循環していないかを検査する。 */
function assertPartialPath(file: string, abs: string, state: PartialState): void {
  const {partialsDir} = state;
  if (!isInside(partialsDir, abs) || abs === partialsDir) {
    throw new Error(
      `[markdoc-vinext] Partial "${file}" in ${state.importer} resolves outside the partials directory (${partialsDir}).`,
    );
  }
  // `a.txt:s.md` は NTFS の代替データストリームで、拡張子の検査を通り別ファイルの内容を読める。
  if (process.platform === 'win32' && abs.slice(path.parse(abs).root.length).includes(':')) {
    throw new Error(
      `[markdoc-vinext] Partial "${file}" in ${state.importer} contains ':' (NTFS alternate data streams are not allowed).`,
    );
  }
  if (!hasExtension(abs, state.allowedExtensions)) {
    throw new Error(
      `[markdoc-vinext] Partial "${file}" in ${state.importer} must have one of these extensions: ${state.allowedExtensions.join(', ')} (see the "partialExtensions" option).`,
    );
  }
  if (state.stack.includes(abs)) {
    throw new Error(`[markdoc-vinext] Circular partial in ${state.importer}: ${partialChain(state, abs)}`);
  }
}

/** `abs` の実パス。シンボリックリンクの先が partialsDir の実パス配下で、許可された拡張子であることを検査する。 */
async function resolvePartialReal(file: string, abs: string, state: PartialState): Promise<string> {
  let real: string;
  try {
    real = await fs.promises.realpath(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(
      `[markdoc-vinext] Partial "${file}" referenced from ${state.importer} was not found at ${abs}${code ? ` (${code})` : ''}.`,
    );
  }
  if (state.realPartialsDir === null) {
    state.realPartialsDir = await fs.promises.realpath(state.partialsDir);
  }
  if (!isInside(state.realPartialsDir, real)) {
    throw new Error(
      `[markdoc-vinext] Partial "${file}" in ${state.importer} is a symlink to ${real}, outside the partials directory.`,
    );
  }
  if (!hasExtension(real, state.allowedExtensions)) {
    throw new Error(
      `[markdoc-vinext] Partial "${file}" in ${state.importer} is a symlink to ${real}, which does not have one of these extensions: ${state.allowedExtensions.join(', ')}.`,
    );
  }
  return real;
}

/** 読み込みの失敗 (ディレクトリ等) を、ファイル内容を含まないエラーにする。 */
async function readPartialFile(file: string, real: string, state: PartialState): Promise<string> {
  try {
    return await fs.promises.readFile(real, {encoding: 'utf8'});
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(
      `[markdoc-vinext] Partial "${file}" in ${state.importer} could not be read${code ? ` (${code})` : ''}.`,
    );
  }
}

/**
 * partial のパスを監視対象に加える。Vite の watcher はディレクトリを再帰的に監視するため、ディレクトリは加えない。
 * 実パスは partialsDir の実パス配下の場合のみ加える。
 */
async function watchPartialPath(abs: string, state: PartialState): Promise<void> {
  if (await isDirectory(abs)) return;
  state.watch(abs, {real: false});
  // シンボリックリンク経由の partials フォルダでは、ファイルの作成・変更は実パスで通知される。
  const real = realpathOfNearestExisting(abs);
  if (real !== abs && isInside(realpathOfNearestExisting(state.partialsDir), real)) state.watch(real, {real: false});
}

/**
 * `{% partial file="..." %}` の file を partialsDir 基準で解決し、検査して読み込む。
 * @returns `abs` は partialsDir 基準の絶対パス (循環検出用)
 */
async function readPartial(file: string, state: PartialState): Promise<{abs: string; content: string}> {
  const abs = path.resolve(state.partialsDir, file);
  assertPartialPath(file, abs, state);
  // 存在しない partial を後から作成した場合に再変換されるよう、読み込み前に監視する。
  await watchPartialPath(abs, state);
  const real = await resolvePartialReal(file, abs, state);
  // キャッシュするのは読み込みのみ。上の包含 / realpath の検査は毎回行う。
  const {cache} = state;
  let content = cache?.partials.get(real);
  if (content === undefined) {
    const generation = cache?.generation;
    content = await readPartialFile(file, real, state);
    if (cache && cache.generation === generation) cache.partials.set(real, content);
  }
  return {abs, content};
}

/**
 * `ast` 内の `{% partial %}` を再帰的に読み込み、`state.partials` に file 属性 → 内容を登録する。
 * 走査と再帰の構造は @markdoc/next.js の src/loader.js を元にしている
 * (MIT, Copyright (c) 2021- Stripe, Inc.。THIRD-PARTY-NOTICES.md 参照)。
 */
export async function gatherPartials(ast: InstanceType<typeof Markdoc.Ast.Node>, state: PartialState): Promise<void> {
  for (const node of ast.walk()) {
    if (node.type !== 'tag' || node.tag !== 'partial') continue;
    const file: unknown = node.attributes.file;
    if (typeof file !== 'string') continue;

    if (state.stack.length > MAX_PARTIAL_DEPTH) {
      throw new Error(
        `[markdoc-vinext] Partials nested deeper than ${MAX_PARTIAL_DEPTH} levels in ${state.importer}: ${partialChain(state, file)}`,
      );
    }

    const abs = path.resolve(state.partialsDir, file);
    // 同じキーで展開済みかつ祖先でなければ再利用する (ダイヤモンド型の include)。
    if (state.partials.has(file) && !state.stack.includes(abs)) continue;

    const {content} = await readPartial(file, state);
    if (!content) continue; // 公式と同じく空の partial は登録しない

    state.partials.set(file, content);
    const nestedAst = state.Markdoc.parse(state.tokenizer.tokenize(content), state.parseOptions);
    state.stack.push(abs);
    try {
      await gatherPartials(nestedAst, state);
    } finally {
      state.stack.pop();
    }
  }
}
