import {defineConfig} from 'vite';
import {markdoc} from '../../src/index';
// Vinext がなくても型チェックできるようコメントアウトしている。Vinext のプロジェクトでは有効にする。
// import vinext from 'vinext';

export default defineConfig({
  plugins: [
    // enforce: 'pre'。vinext() より前に置き、.md / .mdoc を JavaScript に変換してから Vinext に渡す。
    markdoc({
      schemaPath: './markdoc',
      mode: 'static',
      extensions: ['.md', '.mdoc'],
      router: 'auto',
      options: {allowComments: true},
    }),
    // vinext(),
  ],
});
