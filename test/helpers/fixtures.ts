import fs from 'node:fs';
import path from 'node:path';

/** 親ディレクトリを作ってファイルを書く。 */
export function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

/** `root` 以下に、相対パス → 内容の対応どおりファイルを書く。 */
export function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) writeFile(path.join(root, rel), content);
}

/**
 * シンボリックリンクを作成する。権限やファイルシステムの制約で作成できない場合は false。
 * それ以外のエラーは投げる。
 * @param type `'junction'` は Windows で管理者権限なしに作れるディレクトリへのリンク。Windows 以外では `'dir'` として扱われる。
 */
export function trySymlink(target: string, link: string, type?: 'file' | 'dir' | 'junction'): boolean {
  fs.rmSync(link, {force: true});
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return false;
    throw error;
  }
}

/**
 * `dir` でファイルへのシンボリックリンクを作成できるか。`test.skipIf(!canSymlink(dir))` に使う。
 * 一時ファイルで試し、後始末する。
 */
export function canSymlink(dir: string): boolean {
  const target = path.join(dir, '.symlink-probe-target');
  const link = path.join(dir, '.symlink-probe-link');
  writeFile(target, '');
  try {
    return trySymlink(target, link);
  } finally {
    fs.rmSync(link, {force: true});
    fs.rmSync(target, {force: true});
  }
}
