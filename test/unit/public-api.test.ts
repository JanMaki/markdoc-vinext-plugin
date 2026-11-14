import {describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import * as publicIndex from '../../src/index';
import * as publicRuntime from '../../src/runtime/index';
import {repoRoot} from '../helpers/paths';

type ExportTarget = {types: string; default?: string};
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, ExportTarget>;
};

/** `./dist/foo.js` / `./dist/foo.d.ts` をビルド前のソース `./src/foo.ts` / `./src/foo.d.ts` に対応させる。 */
function sourceOf(target: string): string {
  return target.replace(/^\.\/dist\//, './src/').replace(/(?<!\.d)\.js$/, '.ts');
}

describe('public API: package entry', () => {
  test('exports are exactly markdoc and default, and default is markdoc', () => {
    expect(Object.keys(publicIndex).sort()).toEqual(['default', 'markdoc']);
    expect(publicIndex.default).toBe(publicIndex.markdoc);
  });

  test('markdoc() returns the markdoc-vinext plugin with enforce: pre', () => {
    const plugin = publicIndex.markdoc({});
    expect(plugin.name).toBe('markdoc-vinext');
    expect(plugin.enforce).toBe('pre');
  });

  test('./runtime exports exactly the four helpers (no renderReact)', () => {
    expect(Object.keys(publicRuntime).sort()).toEqual([
      'defaultObject',
      'displayName',
      'getSchema',
      'sanitizeFrontmatter',
    ]);
  });
});

describe('public API: package.json exports', () => {
  test('keys are exactly ., ./runtime and ./env', () => {
    expect(Object.keys(pkg.exports)).toEqual(['.', './runtime', './env']);
  });

  test('targets point to dist and have a source file', () => {
    expect(Object.values(pkg.exports)).toEqual([
      {types: './dist/index.d.ts', default: './dist/index.js'},
      {types: './dist/runtime/index.d.ts', default: './dist/runtime/index.js'},
      {types: './dist/env.d.ts'},
    ]);
    const sources = Object.values(pkg.exports).map((t) => sourceOf(t.default ?? t.types));
    expect(sources).toEqual(['./src/index.ts', './src/runtime/index.ts', './src/env.d.ts']);
    for (const source of sources) expect(fs.existsSync(path.join(repoRoot, source))).toBe(true);
  });

  test('./env is resolved through a types condition', () => {
    expect(Object.keys(pkg.exports['./env'] as object)).toEqual(['types']);
  });
});
