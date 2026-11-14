import {describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {repoRoot} from '../helpers/paths';

const LAZY_DEPS = ['@markdoc/markdoc', 'js-yaml'];

type ScannedImport = {file: string; path: string; kind: string};

/** `dir` 以下で `pattern` に一致するファイルの、リポジトリからの `/` 区切りの相対パス。 */
function filesUnder(dir: string, pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({cwd: path.join(repoRoot, dir)})].map((rel) =>
    `${dir}/${rel}`.replaceAll('\\', '/'),
  );
}

/**
 * `files` の import を列挙する。file はリポジトリからの相対パス。
 * scanImports は型 import と、生成コードのテンプレート文字列内の import を返さない。
 */
function scanImports(files: string[]): ScannedImport[] {
  const transpiler = new Bun.Transpiler({loader: 'ts'});
  return files.flatMap((file) =>
    transpiler
      .scanImports(fs.readFileSync(path.join(repoRoot, file), 'utf8'))
      .map((i) => ({file, path: i.path, kind: i.kind})),
  );
}

describe('architecture: value imports', () => {
  test('src/**: @markdoc/markdoc and js-yaml are value-imported only in src/markdoc-deps.ts', () => {
    const lazy = scanImports(filesUnder('src', '**/*.ts')).filter((i) => LAZY_DEPS.includes(i.path));
    const violations = lazy.filter((i) => i.file !== 'src/markdoc-deps.ts' || i.kind !== 'dynamic-import');
    expect(violations).toEqual([]);
    // markdoc-deps.ts は両方を動的 import で読み込む。
    const dynamic = lazy.filter((i) => i.file === 'src/markdoc-deps.ts').map((i) => i.path);
    expect(dynamic.sort()).toEqual([...LAZY_DEPS].sort());
  });

  test('src/**: vite is value-imported only under src/vite/', () => {
    const violations = scanImports(filesUnder('src', '**/*.ts')).filter(
      (i) => i.path === 'vite' && !i.file.startsWith('src/vite/'),
    );
    expect(violations).toEqual([]);
  });
});

describe('architecture: file contents', () => {
  test('src/** and test/** contain no C0 control characters other than \\t \\n \\r', () => {
    const files = [...filesUnder('src', '**/*'), ...filesUnder('test', '**/*')].filter(
      (f) => !f.includes('/__snapshots__/'),
    );
    const violations: string[] = [];
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(repoRoot, file));
      const index = bytes.findIndex((b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
      if (index !== -1) violations.push(`${file} @${index}: 0x${bytes[index]?.toString(16).padStart(2, '0')}`);
    }
    // 走査対象に含まれるべきファイル。
    expect(files).toEqual(
      expect.arrayContaining([
        'src/index.ts',
        'src/runtime/runtime.js',
        'src/env.d.ts',
        'src/vite/plugin.ts',
        'test/setup.ts',
        'test/unit/architecture.test.ts',
        'test/helpers/paths.ts',
      ]),
    );
    expect(violations).toEqual([]);
  });
});
