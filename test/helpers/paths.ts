import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** リポジトリのルート。 */
export const repoRoot = path.resolve(import.meta.dir, '../..');

/** サンプルのプロジェクトのルート。既定の app/ pages/ markdoc/ を持つ。 */
export const exampleRoot = path.join(repoRoot, 'examples/basic');

export const pagesSample = path.join(exampleRoot, 'pages/docs/getting-started.md');
export const appSample = path.join(exampleRoot, 'app/docs/page.md');
export const componentSample = path.join(exampleRoot, 'components/note.md');

/**
 * テストファイル専用の作業ディレクトリ `<repo>/tmp/test/<ファイル名の stem>/` を作り直して返す。
 * @param meta 呼び出し元テストの `import.meta`
 */
export function tmpDirFor(meta: ImportMeta): string {
  const stem = path.basename(fileURLToPath(meta.url)).replace(/\.test\.[cm]?[jt]sx?$/, '');
  const dir = path.join(repoRoot, 'tmp', 'test', stem);
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  return dir;
}
