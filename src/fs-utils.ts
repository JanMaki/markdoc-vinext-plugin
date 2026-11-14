/** ファイルシステムの補助関数。 */

import fs from 'node:fs';
import path from 'node:path';

/** 実パス。解決できなければ `p` をそのまま返す。 */
export function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/** 存在する最も近い祖先 (自身を含む) を実パスにしたパス。存在しないファイルの監視用。 */
export function realpathOfNearestExisting(p: string): string {
  const rest: string[] = [];
  let current = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return p;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** 存在するディレクトリか。 */
export async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** 存在するファイルか。 */
export async function isFile(target: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}
