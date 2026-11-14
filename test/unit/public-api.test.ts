import {describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import * as publicIndex from '../../src/index';
import * as publicRuntime from '../../src/runtime/index';
import {repoRoot} from '../helpers/paths';

type ExportTarget = string | {types?: string};
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, ExportTarget>;
};

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

  test('every target file exists', () => {
    const targets = Object.values(pkg.exports).map((t) => (typeof t === 'string' ? t : t.types));
    expect(targets).toEqual(['./src/index.ts', './src/runtime/index.ts', './src/env.d.ts']);
    for (const target of targets) expect(fs.existsSync(path.join(repoRoot, target as string))).toBe(true);
  });

  test('./env is resolved through a types condition', () => {
    expect(Object.keys(pkg.exports['./env'] as object)).toEqual(['types']);
  });
});
