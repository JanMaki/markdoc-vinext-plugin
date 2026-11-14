/**
 * ビルド後の dist/ を検査する。`bun run test:package` (build の後に実行) でのみ実行する。
 * dist/ はビルド前に存在しないため、型チェックが dist/ の型宣言に依存しないよう動的 import のパスは文字列で組み立てる。
 */
import {describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repoRoot} from '../helpers/paths';

type ExportTarget = {types: string; default?: string};
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, ExportTarget>;
};

function importDist(target: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(path.join(repoRoot, target)).href);
}

describe('package: dist', () => {
  test('every export target exists', () => {
    const targets = Object.values(pkg.exports).flatMap((t) => [t.types, t.default].filter((v) => v !== undefined));
    for (const target of targets) expect(fs.existsSync(path.join(repoRoot, target))).toBe(true);
  });

  test('. exports markdoc and default', async () => {
    const entry = await importDist(pkg.exports['.']?.default as string);
    expect(Object.keys(entry).sort()).toEqual(['default', 'markdoc']);
  });

  test('./runtime exports exactly the four helpers', async () => {
    const runtime = await importDist(pkg.exports['./runtime']?.default as string);
    expect(Object.keys(runtime).sort()).toEqual(['defaultObject', 'displayName', 'getSchema', 'sanitizeFrontmatter']);
  });

  // 仮想 runtime は dist/runtime/source.js が隣の runtime.js を文字列として読む。
  test('the inline runtime source is the unmodified runtime.js', async () => {
    const {INLINE_RUNTIME_SOURCE} = await importDist('dist/runtime/source.js');
    expect(INLINE_RUNTIME_SOURCE).toBe(fs.readFileSync(path.join(repoRoot, 'src/runtime/runtime.js'), 'utf8'));
    expect(INLINE_RUNTIME_SOURCE).toContain('export function renderReact(');
  });
});
