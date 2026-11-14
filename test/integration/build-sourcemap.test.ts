import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import {pagesSample, tmpDirFor} from '../helpers/paths';
import {PAGE_RAW_MARKERS, RAW_MARKERS} from '../helpers/transform';
import {measureBuild} from '../helpers/vite';

const dir = tmpDirFor(import.meta);

/** `.map` の sources と、スキーマモジュールを除いた sourcesContent の連結。 */
function readSourcesContent(file: string): {sources: string[]; content: string} {
  const map = JSON.parse(fs.readFileSync(file, 'utf8')) as {sources: string[]; sourcesContent?: (string | null)[]};
  // サンプルのスキーマモジュール (markdoc/*.ts, *.tsx) はコメントに Markdoc の記法を含むため対象外にする。
  const content = (map.sourcesContent ?? [])
    .filter((text, i) => text && !/(?:^|\/)markdoc\/.*\.tsx?$/.test(map.sources[i] ?? ''))
    .join('\n');
  return {sources: map.sources, content};
}

// build.sourcemap 有効時、Rollup はモジュールの元のコード (.md そのもの) を sourcesContent に入れる。
// fastRefresh のビルドはページモジュールとコンポーネントモジュールの両方を含む。
describe("compile: 'build' + fastRefresh", () => {
  let map = {sources: [] as string[], content: ''};
  beforeAll(async () => {
    const out = await measureBuild(
      pagesSample,
      dir,
      'smap-build-fr.js',
      {compile: 'build', fastRefresh: true},
      {
        sourcemap: true,
      },
    );
    map = readSourcesContent(`${out}.map`);
  }, 120000);

  test('client build.sourcemap lists no .md source and its sourcesContent has no raw Markdown', () => {
    expect(map.sources.filter((src) => /\.md$/i.test(src))).toEqual([]);
    expect(RAW_MARKERS.filter((m) => map.content.includes(m))).toEqual([]);
  });
});

describe("compile: 'runtime' (positive control)", () => {
  let map = {sources: [] as string[], content: ''};
  beforeAll(async () => {
    const out = await measureBuild(pagesSample, dir, 'smap-runtime.js', {}, {sourcemap: true});
    map = readSourcesContent(`${out}.map`);
  }, 120000);

  test('build.sourcemap lists the .md and its sourcesContent has the page markers', () => {
    expect(map.sources.filter((src) => src.endsWith('getting-started.md'))).toHaveLength(1);
    expect(PAGE_RAW_MARKERS.filter((m) => !map.content.includes(m))).toEqual([]);
  });
});
