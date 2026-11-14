/** partials フォルダの監視可否の判定。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {realpathOrSelf} from './fs-utils';
import {isInside, isTooBroadToAllow} from './paths';

/**
 * `<schemaDir>/partials` が存在し、実パスがファイルシステムのルート・ホームディレクトリ・プロジェクトルートを含む場合に実パスを返す。
 * watcher は再帰的に監視するため、この場合は監視対象に加えない。該当しなければ null。
 */
export function findBroadPartialsDir(schemaDir: string, root: string): string | null {
  const partialsDir = path.join(schemaDir, 'partials');
  if (!fs.existsSync(partialsDir)) return null;
  const real = realpathOrSelf(partialsDir);
  return isTooBroadToAllow(real, os.homedir()) || isInside(real, realpathOrSelf(root)) ? real : null;
}

/** 監視から外した partials フォルダの警告文。 */
export function broadPartialsWarning(partialsDir: string, realPartialsDir: string): string {
  return (
    `[markdoc-vinext] The partials folder (${partialsDir}) resolves to ${realPartialsDir}, which contains the ` +
    'project root, the home directory or a filesystem root, so it was not added to the watcher.'
  );
}
