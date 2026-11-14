/** @markdoc/markdoc と js-yaml の遅延読み込み。 */

// 型のみ。パッケージ本体は loadMarkdocDeps() で遅延読み込みする。
import type Markdoc from '@markdoc/markdoc';
import type {load as YamlLoad} from 'js-yaml';

export type MarkdocModule = typeof Markdoc;
let markdocDeps: Promise<{Markdoc: MarkdocModule; yamlLoad: typeof YamlLoad}> | undefined;

/** @markdoc/markdoc と js-yaml を初回使用時に読み込む。プラグインの import 時には読み込まない。 */
export function loadMarkdocDeps(): Promise<{Markdoc: MarkdocModule; yamlLoad: typeof YamlLoad}> {
  markdocDeps ??= Promise.all([import('@markdoc/markdoc'), import('js-yaml')]).then(([m, y]) => ({
    // CJS interop: Node では default が module.exports、ESM ビルドでは default が Markdoc クラス。
    Markdoc: (m.default ?? m) as MarkdocModule,
    yamlLoad: y.load,
  }));
  return markdocDeps;
}
