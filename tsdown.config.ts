import {copyFile} from 'node:fs/promises';
import {defineConfig} from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/runtime/index.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  // runtime/source.ts が `./runtime.js` を import.meta.url からの相対パスで読むため、src の構成のまま出力する。
  unbundle: true,
  fixedExtension: false,
  dts: true,
  clean: true,
  copy: [{from: 'src/env.d.ts', to: 'dist'}],
  hooks: {
    // runtime.js は仮想モジュールとして文字列のまま配信する。ビルド結果は未使用の export (renderReact) と
    // ライセンス表示のコメントが除かれるため、元のファイルで置き換える。
    'build:done': async () => {
      await copyFile('src/runtime/runtime.js', 'dist/runtime/runtime.js');
    },
  },
});
